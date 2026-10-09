import Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { printOrders, cookbookPrintProjects, type PrintOrder, type PrintOrderStatus } from "@shared/schema";
import { estimateArrival } from "@shared/print-checkout";
import { calculateCost, createPrintJob, getPrintJob } from "./lulu/client";
import { buildPodPackageId, BINDING_PAGE_LIMITS } from "./lulu/pod-package";
import { flattenLuluMessages } from "./lulu/preflight";
import type { BookConfig, LuluAddress, ShippingLevel } from "./lulu/types";
import { generateInteriorPdf, generateCoverPdf, type CookbookPrintData } from "./pdf/generator";

// A printed-book order, from "Place order" to the door:
//
//   preparing         the PDFs are made (about a minute) and Lulu prices the
//                     book at its exact page count
//   awaiting_payment  the customer is on Stripe's checkout page
//   paid              Stripe confirmed the payment (webhook, or the return
//                     page asking Stripe directly)
//   submitted         Lulu has the print job; Lulu's own status is in
//                     luluStatus (UNPAID -> ... -> SHIPPED, or REJECTED)
//   failed/refunded   something went wrong; a paid order is refunded
//
// Without Stripe keys (STRIPE_SECRET_KEY) orders skip payment, which is only
// allowed while Lulu is in sandbox mode: in production that would bill every
// order to the owner's Lulu account.

const stripeKey = () => process.env.STRIPE_SECRET_KEY || "";
export const paymentsEnabled = () => !!stripeKey();
export const luluIsProduction = () => process.env.LULU_ENVIRONMENT === "production";
let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  if (!stripeClient) stripeClient = new Stripe(stripeKey());
  return stripeClient;
}

/** Customer price from Lulu's total: PRINT_MARKUP_PERCENT and PRINT_MARKUP_FLAT (dollars), both default 0 */
export function customerPriceCents(luluTotalCents: number): number {
  const pct = Number(process.env.PRINT_MARKUP_PERCENT || 0);
  const flat = Number(process.env.PRINT_MARKUP_FLAT || 0);
  return Math.round(luluTotalCents * (1 + (Number.isFinite(pct) ? pct : 0) / 100) + (Number.isFinite(flat) ? flat : 0) * 100);
}

// ---- Building the book's files -------------------------------------------

type PrintDataBuilder = (order: PrintOrder) => Promise<CookbookPrintData>;
let buildPrintData: PrintDataBuilder | null = null;
/** routes/cookbooks.ts registers how a book is assembled (it owns those helpers) */
export function setOrderPrintDataBuilder(fn: PrintDataBuilder) {
  buildPrintData = fn;
}

// Files Lulu downloads. Kept in memory, and rebuilt from the order if the
// server restarted before Lulu fetched them (the order holds everything the
// book needs), so a deploy can't lose an order's files.
const files = new Map<string, { interior: Buffer; cover: Buffer; at: number }>();
const building = new Map<string, Promise<{ interior: Buffer; cover: Buffer; pageCount: number }>>();
const FILE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export function orderFiles(order: PrintOrder): Promise<{ interior: Buffer; cover: Buffer; pageCount: number }> {
  const cached = files.get(order.id);
  if (cached) return Promise.resolve({ ...cached, pageCount: order.pageCount ?? 0 });
  let p = building.get(order.id);
  if (!p) {
    p = (async () => {
      if (!buildPrintData) throw new Error("Order builder not registered");
      const data = await buildPrintData(order);
      const interior = await generateInteriorPdf(data);
      const cover = await generateCoverPdf(data, interior.pageCount);
      const now = Date.now();
      files.forEach((v, k) => { if (now - v.at > FILE_TTL_MS) files.delete(k); });
      files.set(order.id, { interior: interior.buffer, cover, at: now });
      return { interior: interior.buffer, cover, pageCount: interior.pageCount };
    })().finally(() => building.delete(order.id));
    building.set(order.id, p);
  }
  return p;
}

export function orderFileUrls(order: PrintOrder) {
  const base = order.snapshot.baseUrl;
  return { interior: `${base}/lulu/order-files/${order.id}/interior.pdf`, cover: `${base}/lulu/order-files/${order.id}/cover.pdf` };
}

// ---- Rows ----------------------------------------------------------------

export async function getOrder(id: string): Promise<PrintOrder | undefined> {
  const [row] = await db.select().from(printOrders).where(eq(printOrders.id, id));
  return row;
}

async function update(id: string, changes: Partial<PrintOrder>): Promise<PrintOrder> {
  const [row] = await db.update(printOrders).set({ ...changes, updatedAt: new Date() }).where(eq(printOrders.id, id)).returning();
  return row;
}

/** Moves an order from one status to the next only if it's still in the first (so two callers can't both act) */
async function claim(id: string, from: PrintOrderStatus, to: PrintOrderStatus): Promise<PrintOrder | null> {
  const [row] = await db.update(printOrders).set({ status: to, updatedAt: new Date() })
    .where(and(eq(printOrders.id, id), eq(printOrders.status, from))).returning();
  return row ?? null;
}

export async function ordersForCookbook(cookbookId: number, userId: string): Promise<PrintOrder[]> {
  return db.select().from(printOrders)
    .where(and(eq(printOrders.cookbookId, cookbookId), eq(printOrders.ownerUserId, userId)))
    .orderBy(desc(printOrders.createdAt));
}

export async function createOrder(row: typeof printOrders.$inferInsert): Promise<PrintOrder> {
  const [order] = await db.insert(printOrders).values(row).returning();
  return order;
}

// ---- The steps -----------------------------------------------------------

function podPackage(order: PrintOrder): string {
  const s = order.snapshot;
  return buildPodPackageId({
    trimSize: s.trimSize, colorType: s.colorType, printQuality: "STD", bindingType: s.bindingType,
    paperType: s.paperType, coverFinish: s.coverFinish, linenColor: "X", foilType: "X",
  } as BookConfig);
}

const cents = (v: string | number | undefined) => Math.round(Number(v || 0) * 100);

/**
 * Makes the files, prices the book at its exact page count, then sends the
 * customer to pay (or, without payments in sandbox, places it straight away).
 * Runs in the background; the order page polls the row.
 */
export async function prepareOrder(orderId: string, returnUrl: string): Promise<void> {
  let order = (await getOrder(orderId))!;
  try {
    const { pageCount } = await orderFiles(order);
    const limits = BINDING_PAGE_LIMITS[order.snapshot.bindingType] || { min: 32, max: 800 };
    if (pageCount > limits.max) {
      await update(order.id, { status: "failed", pageCount, problem: `The book came out at ${pageCount} pages, more than this binding holds (${limits.max}). Choose another binding or take some recipes out.` });
      return;
    }
    const quote = await calculateCost({
      line_items: [{ pod_package_id: podPackage(order), page_count: pageCount, quantity: order.quantity }],
      shipping_address: order.shippingAddress as LuluAddress,
      shipping_level: order.shippingLevel as ShippingLevel,
    });
    const luluCostCents = cents(quote.total_cost_incl_tax);
    const priceCents = customerPriceCents(luluCostCents);
    order = await update(order.id, { pageCount, luluCostCents, priceCents, currency: quote.currency || "USD" });

    if (!paymentsEnabled()) {
      if (luluIsProduction()) {
        await update(order.id, { status: "failed", problem: "Ordering isn't open yet: payments aren't set up. Nothing was charged." });
        return;
      }
      // Sandbox testing without Stripe: nothing is charged anywhere
      const paid = await claim(order.id, "preparing", "paid");
      if (paid) await submitToLulu(paid);
      return;
    }

    const s = order.snapshot;
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: order.contactEmail,
      client_reference_id: order.id,
      metadata: { orderId: order.id },
      payment_intent_data: { metadata: { orderId: order.id } },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (order.currency || "USD").toLowerCase(),
          unit_amount: priceCents,
          product_data: {
            name: `${s.title} — printed cookbook`,
            description: `${order.quantity} ${order.quantity === 1 ? "copy" : "copies"}, ${pageCount} pages, shipping and tax included`,
          },
        },
      }],
      success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}order=${order.id}`,
      cancel_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}order=${order.id}&canceled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // an hour to pay; the price is from now
    });
    await update(order.id, { status: "awaiting_payment", stripeSessionId: session.id, checkoutUrl: session.url });
  } catch (err: any) {
    console.error(`[Order ${orderId}] Preparing failed:`, err);
    await update(orderId, { status: "failed", problem: "We couldn't get the book ready to print. Nothing was charged. Try again in a few minutes." }).catch(() => {});
  }
}

/** Stripe says the checkout is paid: place the print job (once) */
export async function markPaid(orderId: string, paymentIntent: string | null): Promise<void> {
  const order = await claim(orderId, "awaiting_payment", "paid");
  if (!order) return; // already handled, or not waiting for payment
  const withPayment = paymentIntent ? await update(order.id, { stripePaymentIntent: paymentIntent }) : order;
  await submitToLulu(withPayment);
}

/** Checkout page closed or expired without paying */
export async function markCheckoutEnded(orderId: string): Promise<void> {
  await claim(orderId, "awaiting_payment", "canceled");
}

async function submitToLulu(order: PrintOrder): Promise<void> {
  try {
    // Lulu downloads the files right away; make sure they're ready to serve
    await orderFiles(order);
    const urls = orderFileUrls(order);
    const job = await createPrintJob({
      contact_email: order.contactEmail,
      external_id: order.id,
      line_items: [{ title: order.snapshot.title, cover: urls.cover, interior: urls.interior, pod_package_id: podPackage(order), quantity: order.quantity }],
      shipping_address: order.shippingAddress as any,
      shipping_level: order.shippingLevel as ShippingLevel,
    });
    const arrival = job.estimated_shipping_dates?.arrival_min && job.estimated_shipping_dates?.arrival_max
      ? { min: job.estimated_shipping_dates.arrival_min.slice(0, 10), max: job.estimated_shipping_dates.arrival_max.slice(0, 10) }
      : estimateArrival(order.shippingLevel as any);
    await update(order.id, { status: "submitted", luluOrderId: String(job.id), luluStatus: job.status?.name ?? null, arrival });
    // The book's page in the app still shows its latest order
    if (order.printProjectId) {
      await db.update(cookbookPrintProjects).set({ luluOrderId: String(job.id), luluOrderStatus: job.status?.name ?? null })
        .where(eq(cookbookPrintProjects.id, order.printProjectId)).catch(() => {});
    }
    console.log(`[Order ${order.id}] Sent to Lulu as #${job.id}`);
  } catch (err: any) {
    console.error(`[Order ${order.id}] Lulu didn't take the order:`, err?.message);
    const refunded = await refund(order, "The printer didn't accept the order");
    await update(order.id, {
      status: refunded ? "refunded" : "failed",
      problem: refunded
        ? "The printer couldn't take this order, so your payment was refunded. Try again, or contact us."
        : "The printer couldn't take this order. Nothing was charged.",
    });
  }
}

/** Refunds a paid order in full; false if there was nothing to refund */
async function refund(order: PrintOrder, reason: string): Promise<boolean> {
  if (!order.stripePaymentIntent || order.refundedAt || !paymentsEnabled()) return false;
  try {
    await stripe().refunds.create({ payment_intent: order.stripePaymentIntent, metadata: { orderId: order.id, reason } });
    await update(order.id, { refundedAt: new Date() });
    console.log(`[Order ${order.id}] Refunded: ${reason}`);
    return true;
  } catch (err: any) {
    console.error(`[Order ${order.id}] Refund failed — refund it in Stripe by hand:`, err?.message);
    return false;
  }
}

/**
 * Brings an order up to date: asks Stripe whether a waiting checkout was
 * paid (so orders work even before the webhook is set up), and asks Lulu for
 * the print job's status, tracking and any rejection.
 */
export async function refreshOrder(order: PrintOrder): Promise<PrintOrder> {
  if (order.status === "awaiting_payment" && order.stripeSessionId && paymentsEnabled()) {
    const session = await stripe().checkout.sessions.retrieve(order.stripeSessionId);
    if (session.payment_status === "paid") {
      await markPaid(order.id, typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null);
    } else if (session.status === "expired") {
      await markCheckoutEnded(order.id);
    }
    return (await getOrder(order.id))!;
  }
  if (order.status === "submitted" && order.luluOrderId) {
    return applyLuluJob(order, await getPrintJob(Number(order.luluOrderId)));
  }
  return order;
}

/** Saves Lulu's view of the job (from a status check or Lulu's webhook) */
export async function applyLuluJob(order: PrintOrder, job: any): Promise<PrintOrder> {
  const status: string | null = job?.status?.name ?? null;
  const tracking = (job?.line_items || []).flatMap((li: any) =>
    li?.tracking_id || (li?.tracking_urls || []).length
      ? [{ carrier: li.carrier_name || undefined, number: li.tracking_id || undefined, url: (li.tracking_urls || [])[0] || undefined }]
      : []);
  const changes: Partial<PrintOrder> = { luluStatus: status };
  if (tracking.length) changes.tracking = tracking;
  if (status === "REJECTED" || status === "CANCELED") {
    const why = flattenLuluMessages((job?.line_items || []).map((li: any) => li?.status?.messages)).join(" ").replace(/\s+/g, " ").trim();
    if (why) console.warn(`[Order ${order.id}] Lulu ${status}: ${why}`);
    const refunded = await refund(order, `Lulu ${status.toLowerCase()} the job`);
    changes.status = refunded || order.refundedAt ? "refunded" : order.status;
    changes.problem = status === "REJECTED"
      ? `The printer couldn't use this book's files, so it wasn't printed.${refunded || order.refundedAt ? " Your payment was refunded in full." : " Nothing was charged."}`
      : `The printer canceled this order.${refunded || order.refundedAt ? " Your payment was refunded." : ""}`;
  }
  const saved = await update(order.id, changes);
  if (order.printProjectId && status) {
    await db.update(cookbookPrintProjects).set({ luluOrderStatus: status })
      .where(and(eq(cookbookPrintProjects.id, order.printProjectId), eq(cookbookPrintProjects.luluOrderId, order.luluOrderId ?? ""))).catch(() => {});
  }
  return saved;
}

export async function orderByLuluId(luluId: string): Promise<PrintOrder | undefined> {
  const [row] = await db.select().from(printOrders).where(eq(printOrders.luluOrderId, luluId));
  return row;
}

export function verifyStripeEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET isn't set");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** What the customer sees about an order */
export function publicOrder(o: PrintOrder) {
  return {
    id: o.id,
    status: o.status,
    luluStatus: o.luluStatus,
    luluOrderId: o.luluOrderId,
    checkoutUrl: o.status === "awaiting_payment" ? o.checkoutUrl : null,
    quantity: o.quantity,
    pageCount: o.pageCount,
    priceCents: o.priceCents,
    currency: o.currency,
    shippingLevel: o.shippingLevel,
    arrival: o.arrival,
    tracking: o.tracking,
    problem: o.problem,
    refunded: !!o.refundedAt,
    title: o.snapshot.title,
    contactEmail: o.contactEmail,
    createdAt: o.createdAt,
  };
}
export type PublicPrintOrder = ReturnType<typeof publicOrder>;
