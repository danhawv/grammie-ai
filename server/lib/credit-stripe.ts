import type Stripe from "stripe";
import { packById, type CreditPack } from "@shared/credits";
import { isMissingCreditTable, type Credits } from "./credits";

// Buying credit packs on the web with Stripe Checkout (mode: payment), using
// the same Stripe account and webhook as printed-book orders
// (server/lib/print-orders.ts). A credit checkout carries
// metadata.kind = "credits", which is how the webhook tells it apart from a
// book order. Credits are granted once per payment intent, by whichever
// comes first: the webhook, or the /credits page asking Stripe on return.

export const CREDIT_METADATA_KIND = "credits";

export interface CheckoutInput {
  userId: string;
  pack: CreditPack;
  /** Where Stripe sends people back: the site's origin */
  origin: string;
  email?: string | null;
}

export async function createCreditCheckout(stripe: Stripe, input: CheckoutInput) {
  const metadata = { kind: CREDIT_METADATA_KIND, userId: input.userId, pack: input.pack.id, credits: String(input.pack.credits) };
  return stripe.checkout.sessions.create({
    mode: "payment",
    ...(input.email ? { customer_email: input.email } : {}),
    client_reference_id: input.userId,
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.pack.priceCents,
        product_data: {
          name: `Grammie credits — ${input.pack.name} pack`,
          description: `${input.pack.credits} credits for adding recipes, dish photos and meal-prep plans. Credits never expire.`,
        },
      },
    }],
    success_url: `${input.origin}/credits?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/credits?status=canceled`,
  });
}

const paymentIntentId = (pi: unknown): string | null =>
  typeof pi === "string" ? pi : (pi as { id?: string } | null)?.id ?? null;

/**
 * Grants a paid credit checkout (idempotent on the payment intent). Returns
 * null when the session isn't a paid credit checkout.
 */
export async function grantFromSession(credits: Credits, session: Stripe.Checkout.Session) {
  const meta = session.metadata ?? {};
  if (meta.kind !== CREDIT_METADATA_KIND || session.payment_status !== "paid") return null;
  const pack = packById(meta.pack);
  const userId = meta.userId;
  if (!pack || !userId) {
    console.error(`[Credits] Paid checkout ${session.id} has unreadable metadata; grant it by hand`, meta);
    return null;
  }
  // The pack's credits at the time of purchase, as promised on the checkout
  const amount = Number(meta.credits) > 0 ? Number(meta.credits) : pack.credits;
  const externalId = paymentIntentId(session.payment_intent) ?? session.id;
  const result = await credits.grantPurchase({
    userId, source: "stripe", externalId, credits: amount,
    meta: { pack: pack.id, sessionId: session.id, amountCents: session.amount_total ?? pack.priceCents },
  });
  if (result.granted) console.log(`[Credits] ${amount} credits (${pack.id}) for user ${userId} from ${externalId}`);
  return result;
}

/**
 * The credit side of the Stripe webhook. "handled" when the event was about
 * credits (answer 200), "ignored" when it's someone else's (book orders).
 * Throws when a credit event couldn't be saved, so Stripe sends it again.
 */
export async function handleCreditStripeEvent(credits: Credits | null, event: Stripe.Event): Promise<"handled" | "ignored"> {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind !== CREDIT_METADATA_KIND) return "ignored";
    if (!credits) throw new Error("Credits aren't running");
    await grantFromSession(credits, session);
    return "handled";
  }
  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.metadata?.kind === CREDIT_METADATA_KIND ? "handled" : "ignored";
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const pi = paymentIntentId(charge.payment_intent);
    if (!pi || !credits) return "ignored";
    // Only payments we credited are ours; book-order refunds pass through
    if (charge.metadata?.kind && charge.metadata.kind !== CREDIT_METADATA_KIND) return "ignored";
    if (!charge.refunded) {
      // Partial refund: the credits stay; adjust by hand if needed
      console.warn(`[Credits] Partial refund on ${pi} (${charge.amount_refunded} of ${charge.amount} cents); credits left as they are`);
      return charge.metadata?.kind === CREDIT_METADATA_KIND ? "handled" : "ignored";
    }
    const ours = charge.metadata?.kind === CREDIT_METADATA_KIND;
    let result;
    try {
      result = await credits.revokePurchase({ source: "stripe", externalId: pi, meta: { chargeId: charge.id } });
    } catch (err) {
      // A refund that isn't known to be ours (a book order) must never fail the webhook
      if (ours) throw err;
      if (!isMissingCreditTable(err)) console.error(`[Credits] Checking refund ${pi} failed:`, err);
      return "ignored";
    }
    if (result.revoked) console.log(`[Credits] Refunded payment ${pi}: credits taken back (balance now ${result.balance})`);
    return result.revoked || ours ? "handled" : "ignored";
  }
  return "ignored";
}
