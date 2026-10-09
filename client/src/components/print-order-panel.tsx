import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, Loader2, Minus, Package, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/page-states";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { US_STATE_OPTIONS, normalizeUsState } from "@shared/us-states";
import {
  DEFAULT_SHIPPING_LEVEL,
  formatDateRange,
  orderStatusLabel,
  shippingLevelName,
  validateAddress,
  validateAddressField,
  type AddressField,
  type ShippingAddressInput,
} from "@shared/print-checkout";
import type { PrintLayoutData } from "@shared/schema";
import { BOOK_SIZES, BINDING_TYPES, PAPER_TYPES, COLOR_TYPES, COVER_FINISHES } from "@/lib/print-constants";
import { TEMPLATE_STYLES } from "@/components/print/look-step";

// Checkout (docs/DESIGN_PRINCIPLES.md §5 and §8):
//   1. Copies, with "about $X including shipping" and an arrival range before any form
//   2. Shipping address, checked field by field when you leave it
//   3. Review = confirmation: cover, copies, address, total, "Place order · $X"
//   4. Confirmation with the order number and status (recorded on the project)

interface BookOrderSpec {
  layoutData: PrintLayoutData;
  templateStyle: string;
  customTemplateId: number | null;
  trimSize: string;
  bindingType: string;
  paperType: string;
  colorType: string;
  coverFinish: string;
}

interface PrintOrderPanelProps {
  cookbookId: number;
  cookbookName: string;
  coverImage?: string | null;
  book: BookOrderSpec;
  estimatedPageCount: number;
  /** Save any pending edits before quoting/ordering */
  flushSave: () => Promise<void>;
  /** "Needs attention" items from Ready to print (shown as a warning) */
  attentionCount?: number;
  onGoToReview?: () => void;
  /** Back to the Look step, where size, binding and paper are chosen */
  onGoToLook?: () => void;
  /** Name of the custom design, when the book uses one */
  customTemplateName?: string;
  existingOrder?: { id: string; status: string | null } | null;
}

interface ShippingOptionQuote {
  id: string;
  name: string;
  shippingCost: number | null;
  arrivalMin: string;
  arrivalMax: string;
  datesFromLulu: boolean;
}

interface Quote {
  totalCost: number;
  printCost: number;
  shippingCost: number;
  currency: string;
  pageCount: number;
  quantity: number;
  isEstimate: boolean;
  shippingLevel: string;
  shippingOptions: ShippingOptionQuote[];
  suggestedAddress: { street1: string; street2?: string | null; city: string; state_code?: string | null; postcode: string; country_code: string } | null;
}

interface LuluStatus {
  configured: boolean;
  testMode?: boolean;
  paymentsEnabled?: boolean;
  canOrder?: boolean;
}

interface OrderResult {
  orderRef: string;
  paymentsEnabled: boolean;
}

/** An order as the server shows it (server/lib/print-orders.ts publicOrder) */
interface PrintOrderView {
  id: string;
  status: "preparing" | "awaiting_payment" | "paid" | "submitted" | "failed" | "refunded" | "canceled";
  luluStatus: string | null;
  luluOrderId: string | null;
  checkoutUrl: string | null;
  quantity: number;
  pageCount: number | null;
  priceCents: number | null;
  shippingLevel: string;
  arrival: { min: string; max: string } | null;
  tracking: { carrier?: string; number?: string; url?: string }[] | null;
  problem: string | null;
  refunded: boolean;
  title: string;
  contactEmail: string;
  createdAt: string;
}

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
];

const money = (n: number) => `$${n.toFixed(2)}`;

type Stage = "start" | "address" | "review" | "placed";

export function PrintOrderPanel({
  cookbookId,
  cookbookName,
  coverImage,
  book,
  estimatedPageCount,
  flushSave,
  attentionCount = 0,
  onGoToReview,
  onGoToLook,
  customTemplateName,
  existingOrder,
}: PrintOrderPanelProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<Stage>("start");
  const [quantity, setQuantity] = useState(1);
  const [shippingLevel, setShippingLevel] = useState<string>(DEFAULT_SHIPPING_LEVEL);
  const [address, setAddress] = useState<ShippingAddressInput>(() => ({
    // Don't ask twice: start from what the account already knows
    name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
    street1: "",
    street2: "",
    city: "",
    state_code: "",
    country_code: "US",
    postcode: "",
    phone_number: "",
    email: user?.email ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<AddressField, string>>>({});
  const [showApt, setShowApt] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  // The order being placed or just paid for; Stripe sends people back with ?order=
  const [orderRef, setOrderRef] = useState<string | null>(() => new URLSearchParams(window.location.search).get("order"));
  const returnedFromCheckout = useRef(new URLSearchParams(window.location.search).has("canceled") ? "canceled" : null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const idempotencyKey = useRef<string>("");
  const submitted = useRef(false);

  const { data: luluStatus, isLoading: statusLoading } = useQuery<LuluStatus>({
    queryKey: ["/api/print/lulu/status"],
    staleTime: 60_000,
  });

  const quoteBody = (withAddress: boolean, level = shippingLevel, copies = quantity) => ({
    cookbookId,
    pageCount: estimatedPageCount,
    quantity: copies,
    shippingLevel: level,
    trimSize: book.trimSize,
    bindingType: book.bindingType,
    paperType: book.paperType,
    colorType: book.colorType,
    coverFinish: book.coverFinish,
    ...(withAddress ? { shippingAddress: address } : {}),
  });

  // "About $X" before any form, for a typical US address
  const estimate = useQuery<Quote>({
    queryKey: ["/api/print/lulu/calculate-price", "estimate", cookbookId, quantity, estimatedPageCount, book.trimSize, book.bindingType, book.paperType, book.colorType, book.coverFinish],
    queryFn: async () => (await apiRequest("POST", "/api/print/lulu/calculate-price", quoteBody(false, DEFAULT_SHIPPING_LEVEL))).json(),
    enabled: !!luluStatus?.configured && stage === "start" && estimatedPageCount > 0,
    staleTime: 5 * 60_000,
  });

  const quoteMutation = useMutation({
    mutationFn: async (level: string) => (await apiRequest("POST", "/api/print/lulu/calculate-price", quoteBody(true, level))).json() as Promise<Quote>,
    onSuccess: (q) => setQuote(q),
  });

  const orderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/print-order`, {
        ...book,
        quantity,
        shippingAddress: address,
        shippingLevel,
        idempotencyKey: idempotencyKey.current,
      });
      return (await res.json()) as OrderResult;
    },
    onSuccess: (r) => {
      setOrderRef(r.orderRef);
      setStage("placed");
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks", cookbookId, "print-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/print-projects"] });
    },
    onError: (err: Error) => {
      // Allow another try with the same key: the server won't order twice
      submitted.current = false;
      const raw = err.message.replace(/^\d+:\s*/, "");
      let msg = raw;
      try { msg = JSON.parse(raw).error ?? raw; } catch { /* plain text */ }
      setOrderError(msg || "The order didn't go through. Nothing was charged. Try again in a moment.");
    },
  });

  // A quote is only good for the address, copies and shipping it was made for
  useEffect(() => {
    if (stage === "review") return;
    setQuote(null);
  }, [address, quantity, stage]);

  const setField = (field: AddressField, value: string) => {
    setAddress((a) => ({ ...a, [field]: value }));
    // Clear an error as soon as it's fixed
    if (errors[field]) {
      const next = { ...address, [field]: value };
      if (!validateAddressField(field, next)) setErrors((e) => ({ ...e, [field]: undefined }));
    }
  };
  const blurField = (field: AddressField) => {
    const msg = validateAddressField(field, address);
    setErrors((e) => ({ ...e, [field]: msg ?? undefined }));
  };

  const goToReview = async () => {
    const all = validateAddress(address);
    setErrors(all);
    const first = Object.keys(all)[0];
    if (first) {
      document.getElementById(`ship-${first}`)?.focus();
      return;
    }
    if (address.country_code === "US") {
      const st = normalizeUsState(address.state_code);
      if (st && st !== address.state_code) setAddress((a) => ({ ...a, state_code: st }));
    }
    await flushSave().catch(() => {});
    quoteMutation.mutate(shippingLevel, {
      onSuccess: () => {
        idempotencyKey.current = crypto.randomUUID();
        submitted.current = false;
        setOrderError(null);
        setStage("review");
      },
    });
  };

  const placeOrder = async () => {
    if (submitted.current) return;
    submitted.current = true;
    setOrderError(null);
    await flushSave().catch(() => {});
    orderMutation.mutate();
  };

  const levelChoices = quote?.shippingOptions ?? estimate.data?.shippingOptions ?? [];
  const selectedOption = levelChoices.find((o) => o.id === shippingLevel);
  const pickedLevel = useRef(false);
  useEffect(() => {
    if (pickedLevel.current || !levelChoices.length || levelChoices.some((o) => o.id === shippingLevel)) return;
    const cheapest = levelChoices.reduce((best, o) => ((o.shippingCost ?? Infinity) < (best.shippingCost ?? Infinity) ? o : best));
    setShippingLevel(cheapest.id);
  }, [levelChoices, shippingLevel]);

  const cover = (
    <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-primary/10 shadow-sm">
      {coverImage ? <img src={coverImage} alt="" className="h-full w-full object-cover" /> : <BookOpen className="h-8 w-8 text-primary" aria-hidden />}
    </div>
  );

  const bookSummary = (
    <div className="flex gap-4">
      {cover}
      <div className="min-w-0">
        <p className="font-serif text-lg font-semibold break-words">{book.layoutData.title || cookbookName}</p>
        <p className="text-sm text-muted-foreground">About {Math.max(estimatedPageCount, quote?.pageCount ?? 0)} pages</p>
      </div>
    </div>
  );

  if (statusLoading) {
    return <div className="flex items-center gap-3 p-4" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Getting prices…</div>;
  }

  if (!luluStatus?.configured || luluStatus.canOrder === false) {
    return (
      <ErrorState
        title="Ordering printed books isn't available right now"
        description="You can still download the PDF from the Review step and print it yourself."
      />
    );
  }

  const testBanner = luluStatus.testMode ? (
    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="print-test-mode">
      Test mode: orders here are not printed, shipped or charged.
    </p>
  ) : null;

  // Only an earlier order that's still on its way is worth showing here. One
  // that was rejected or canceled has nothing to do with the new order (it
  // gets new files), and it read like this order had failed.
  // Orders placed before order history existed only live on the project
  const earlierFailed = existingOrder?.status === "REJECTED" || existingOrder?.status === "CANCELED";
  const lastOrder = stage === "placed" ? null : (
    <OrderHistory cookbookId={cookbookId} legacy={existingOrder?.id && !earlierFailed ? existingOrder : null} />
  );

  // Everything that decides what gets printed, for the final check
  const size = BOOK_SIZES[book.trimSize as keyof typeof BOOK_SIZES];
  const inches = (n: number) => `${n}″`;
  const bookDetails: { label: string; value: string }[] = [
    { label: "Size", value: size ? `${size.name}, ${inches(size.width)} × ${inches(size.height)}` : book.trimSize },
    { label: "Binding", value: BINDING_TYPES[book.bindingType as keyof typeof BINDING_TYPES]?.name ?? book.bindingType },
    { label: "Cover", value: COVER_FINISHES[book.coverFinish as keyof typeof COVER_FINISHES]?.name ?? book.coverFinish },
    { label: "Pages", value: `${Math.max(estimatedPageCount, quote?.pageCount ?? 0)}` },
    { label: "Printing", value: COLOR_TYPES[book.colorType as keyof typeof COLOR_TYPES]?.name ?? book.colorType },
    { label: "Paper", value: PAPER_TYPES[book.paperType as keyof typeof PAPER_TYPES]?.name ?? book.paperType },
    { label: "Design", value: book.customTemplateId ? customTemplateName ?? "Your own design" : TEMPLATE_STYLES.find((t) => t.id === book.templateStyle)?.name ?? book.templateStyle },
  ];

  // ---- 4. Confirmation ----
  if (orderRef) {
    return (
      <div className="space-y-4">
        <OrderTracker
          orderId={orderRef}
          returnedCanceled={returnedFromCheckout.current === "canceled"}
          email={address.email}
          onStartOver={() => {
            returnedFromCheckout.current = null;
            setOrderRef(null);
            submitted.current = false;
            setStage("start");
            const url = new URL(window.location.href);
            url.searchParams.delete("order");
            url.searchParams.delete("canceled");
            window.history.replaceState(null, "", url);
          }}
        />
        {testBanner}
      </div>
    );
  }

  // ---- 3. Review (this is the confirmation) ----
  if (stage === "review" && quote) {
    const opt = quote.shippingOptions.find((o) => o.id === shippingLevel);
    const label = luluStatus.paymentsEnabled ? `Continue to payment · ${money(quote.totalCost)}` : `Place order · ${money(quote.totalCost)}`;
    return (
      <div className="space-y-5" data-testid="order-review">
        <h2 className="text-xl font-semibold">Check your order</h2>
        {bookSummary}
        <section aria-labelledby="book-details-heading" className="rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <h3 id="book-details-heading" className="font-semibold">Your book</h3>
            {onGoToLook && <Button variant="ghost" onClick={onGoToLook}>Change</Button>}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {bookDetails.map((d) => (
              <div key={d.label} className="flex items-start gap-3 px-3 py-2">
                <dt className="w-20 shrink-0 text-sm text-muted-foreground">{d.label}</dt>
                <dd className="min-w-0 flex-1">{d.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <dl className="divide-y rounded-lg border">
          <Row label="Copies" value={`${quantity}`} />
          <Row
            label="Ship to"
            value={
              <address className="not-italic">
                {address.name}<br />
                {address.street1}{address.street2 ? `, ${address.street2}` : ""}<br />
                {address.city}{address.state_code ? `, ${address.state_code}` : ""} {address.postcode}<br />
                {COUNTRIES.find((c) => c.code === address.country_code)?.name ?? address.country_code}
              </address>
            }
            action={<Button variant="ghost" onClick={() => setStage("address")}>Change</Button>}
          />
          <Row
            label="Shipping"
            value={`${shippingLevelName(shippingLevel)}${opt ? ` · arrives about ${formatDateRange(opt.arrivalMin, opt.arrivalMax)}` : ""}`}
            action={<Button variant="ghost" onClick={() => setStage("address")}>Change</Button>}
          />
          <Row label="Printing" value={money(quote.printCost)} />
          <Row label="Shipping" value={money(quote.shippingCost)} />
          <Row label={<span className="font-semibold">Total</span>} value={<span className="text-lg font-semibold">{money(quote.totalCost)} {quote.currency}</span>} />
        </dl>
        <p className="text-sm text-muted-foreground">
          Includes tax. Printing takes a few business days before the book ships.
          {luluStatus.paymentsEnabled && " You'll pay on Stripe's secure checkout page next."}{" "}
          <a href="/print-policy" target="_blank" rel="noreferrer" className="text-primary underline">Printing, refunds and returns</a>
        </p>

        {quote.suggestedAddress && (
          <SuggestedAddress
            entered={address}
            suggested={quote.suggestedAddress}
            onUse={() => {
              const s = quote.suggestedAddress!;
              setAddress((a) => ({ ...a, street1: s.street1, street2: s.street2 ?? a.street2, city: s.city, state_code: s.state_code ?? a.state_code, postcode: s.postcode }));
              setQuote({ ...quote, suggestedAddress: null });
            }}
            onKeep={() => setQuote({ ...quote, suggestedAddress: null })}
          />
        )}

        {orderError && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            {orderError}
          </p>
        )}
        {testBanner}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={() => setStage("address")} disabled={orderMutation.isPending}>Back</Button>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={placeOrder}
            disabled={orderMutation.isPending || submitted.current || !!quote.suggestedAddress}
            data-testid="button-submit-order"
          >
            {orderMutation.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Placing your order…</> : label}
          </Button>
        </div>
      </div>
    );
  }

  // ---- 2. Address ----
  if (stage === "address") {
    return (
      <div className="space-y-5">
        <h2 className="text-xl font-semibold">Where should we send it?</h2>
        <form
          className="space-y-4"
          autoComplete="on"
          noValidate
          onSubmit={(e) => { e.preventDefault(); void goToReview(); }}
        >
          <Field id="name" label="Full name" error={errors.name}>
            <Input id="ship-name" name="name" autoComplete="shipping name" value={address.name} onChange={(e) => setField("name", e.target.value)} onBlur={() => blurField("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "err-name" : undefined} data-testid="input-shipping-name" />
          </Field>

          <Field id="country_code" label="Country">
            <select
              id="ship-country_code"
              name="country"
              autoComplete="shipping country"
              value={address.country_code}
              onChange={(e) => setField("country_code", e.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              data-testid="select-shipping-country"
            >
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>

          <Field id="street1" label="Street address" error={errors.street1}>
            <Input id="ship-street1" name="address-line1" autoComplete="shipping address-line1" placeholder="e.g. 12 Oak Street" value={address.street1} onChange={(e) => setField("street1", e.target.value)} onBlur={() => blurField("street1")} aria-invalid={!!errors.street1} aria-describedby={errors.street1 ? "err-street1" : undefined} data-testid="input-shipping-street1" />
          </Field>

          {showApt || address.street2 ? (
            <Field id="street2" label="Apartment, suite or unit (optional)">
              <Input id="ship-street2" name="address-line2" autoComplete="shipping address-line2" value={address.street2} onChange={(e) => setField("street2", e.target.value)} autoFocus={showApt && !address.street2} data-testid="input-shipping-street2" />
            </Field>
          ) : (
            <button type="button" className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setShowApt(true)}>
              + Add apartment or suite
            </button>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="city" label="City" error={errors.city}>
              <Input id="ship-city" name="city" autoComplete="shipping address-level2" value={address.city} onChange={(e) => setField("city", e.target.value)} onBlur={() => blurField("city")} aria-invalid={!!errors.city} aria-describedby={errors.city ? "err-city" : undefined} data-testid="input-shipping-city" />
            </Field>
            <Field id="state_code" label={address.country_code === "US" ? "State" : "State or province (optional)"} error={errors.state_code}>
              {address.country_code === "US" ? (
                <select
                  id="ship-state_code"
                  name="state"
                  autoComplete="shipping address-level1"
                  value={address.state_code}
                  onChange={(e) => setField("state_code", e.target.value)}
                  onBlur={() => blurField("state_code")}
                  aria-invalid={!!errors.state_code}
                  aria-describedby={errors.state_code ? "err-state_code" : undefined}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                  data-testid="select-shipping-state"
                >
                  <option value="">Choose a state</option>
                  {US_STATE_OPTIONS.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              ) : (
                <Input id="ship-state_code" name="state" autoComplete="shipping address-level1" value={address.state_code} onChange={(e) => setField("state_code", e.target.value)} data-testid="input-shipping-state" />
              )}
            </Field>
            <Field id="postcode" label={address.country_code === "US" ? "ZIP code" : "Postal code"} error={errors.postcode}>
              <Input
                id="ship-postcode"
                name="postal-code"
                autoComplete="shipping postal-code"
                inputMode={address.country_code === "US" ? "numeric" : "text"}
                autoCapitalize="characters"
                autoCorrect="off"
                value={address.postcode}
                onChange={(e) => setField("postcode", e.target.value)}
                onBlur={() => blurField("postcode")}
                aria-invalid={!!errors.postcode}
                aria-describedby={errors.postcode ? "err-postcode" : undefined}
                data-testid="input-shipping-postcode"
              />
            </Field>
          </div>

          <Field id="phone_number" label="Phone" hint="Only for the delivery driver, if they need to reach you." error={errors.phone_number}>
            <Input id="ship-phone_number" name="tel" type="tel" inputMode="tel" autoComplete="shipping tel" value={address.phone_number} onChange={(e) => setField("phone_number", e.target.value)} onBlur={() => blurField("phone_number")} aria-invalid={!!errors.phone_number} aria-describedby={`hint-phone_number${errors.phone_number ? " err-phone_number" : ""}`} data-testid="input-shipping-phone" />
          </Field>

          <Field id="email" label="Email for order updates" hint={user?.email ? "We'll use your account email if you leave this blank." : undefined} error={errors.email}>
            <Input id="ship-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={address.email} onChange={(e) => setField("email", e.target.value)} onBlur={() => blurField("email")} aria-invalid={!!errors.email} aria-describedby={errors.email ? "err-email" : undefined} data-testid="input-shipping-email" />
          </Field>

          <fieldset className="space-y-2">
            <legend className="font-medium">Shipping</legend>
            {(levelChoices.length ? levelChoices : [{ id: DEFAULT_SHIPPING_LEVEL, name: shippingLevelName(DEFAULT_SHIPPING_LEVEL), shippingCost: null, arrivalMin: "", arrivalMax: "", datesFromLulu: false }]).map((o) => (
              <label
                key={o.id}
                className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3", shippingLevel === o.id ? "border-primary bg-primary/5" : "hover:bg-accent/50")}
              >
                <input type="radio" name="shipping" value={o.id} checked={shippingLevel === o.id} onChange={() => { pickedLevel.current = true; setShippingLevel(o.id); }} className="h-5 w-5 accent-[hsl(26_85%_38%)]" />
                <span className="flex-1">
                  <span className="block font-medium">{o.name}</span>
                  {o.arrivalMin && <span className="block text-sm text-muted-foreground">Arrives about {formatDateRange(o.arrivalMin, o.arrivalMax)}</span>}
                </span>
                {o.shippingCost != null && <span className="text-sm">{money(o.shippingCost)}</span>}
              </label>
            ))}
            <p className="text-sm text-muted-foreground">Shipping prices are before tax; the review shows your exact total.</p>
          </fieldset>

          {quoteMutation.isError && (
            <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm">
              We couldn't get a price for this address. Check it and try again.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" onClick={() => setStage("start")}>Back</Button>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={quoteMutation.isPending} data-testid="button-calculate-price">
              {quoteMutation.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Getting your price…</> : "Review order"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // ---- 1. Start: copies and an early estimate ----
  const est = estimate.data;
  const estOpt = est?.shippingOptions.find((o) => o.id === DEFAULT_SHIPPING_LEVEL) ?? est?.shippingOptions[0];
  // The next-cheapest option, to say faster shipping exists and what it starts at
  const fastest = est?.shippingOptions
    .filter((o) => o.shippingCost != null && o.id !== estOpt?.id && o.shippingCost > (est.shippingOptions.find((x) => x.id === estOpt?.id)?.shippingCost ?? 0))
    .reduce<ShippingOptionQuote | undefined>((best, o) => (!best || o.shippingCost! < best.shippingCost! ? o : best), undefined);
  return (
    <div className="space-y-5">
      {lastOrder}
      {attentionCount > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/50 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            {attentionCount} {attentionCount === 1 ? "thing needs" : "things need"} attention before printing.
          </p>
          {onGoToReview && <Button variant="outline" onClick={onGoToReview}>See what to fix</Button>}
        </div>
      )}

      {bookSummary}

      <div className="space-y-2">
        <Label htmlFor="copies">Copies</Label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="One fewer copy" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1}>
            <Minus aria-hidden />
          </Button>
          <Input
            id="copies"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={quantity}
            onChange={(e) => setQuantity(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
            className="h-11 w-20 text-center"
            data-testid="input-quantity"
          />
          <Button type="button" variant="outline" size="icon" aria-label="One more copy" onClick={() => setQuantity((q) => Math.min(100, q + 1))} disabled={quantity >= 100}>
            <Plus aria-hidden />
          </Button>
        </div>
      </div>

      {quantity > 1 && (
        <div className="rounded-lg border p-4">
          <p className="font-medium">Order a single proof copy first?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check one printed book before ordering {quantity} copies. You can order the rest once you're happy with it.
          </p>
          <Button variant="outline" className="mt-3" onClick={() => setQuantity(1)} data-testid="button-proof-copy">
            Order 1 proof copy
          </Button>
        </div>
      )}

      <div className="rounded-lg bg-muted/50 p-4" aria-live="polite">
        {estimate.isLoading ? (
          <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Working out the price…</p>
        ) : estimate.isError ? (
          <p className="text-sm">We couldn't estimate the price right now. You'll see the exact total before you order.</p>
        ) : est ? (
          <>
            <p className="text-lg font-semibold" data-testid="text-estimated-total">
              About ${Math.ceil(est.totalCost)} including shipping
            </p>
            <dl className="mt-2 max-w-sm space-y-1 text-sm" data-testid="estimate-breakdown">
              <div className="flex justify-between gap-4">
                <dt>Printing, {quantity} {quantity === 1 ? "copy" : "copies"}</dt>
                <dd>{money(est.printCost)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Shipping, {shippingLevelName(estOpt?.id ?? DEFAULT_SHIPPING_LEVEL).toLowerCase()}</dt>
                <dd>{money(est.shippingCost)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-1 font-medium">
                <dt>Total</dt>
                <dd>{money(est.totalCost)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-sm text-muted-foreground">
              {estOpt ? `Arrives about ${formatDateRange(estOpt.arrivalMin, estOpt.arrivalMax)}. ` : ""}
              Includes estimated tax. The exact price depends on your address.
            </p>
            {fastest && (
              <p className="mt-2 text-sm" data-testid="estimate-faster">
                Faster shipping is available when you add your address, from {money(fastest.shippingCost!)}.
              </p>
            )}
          </>
        ) : null}
      </div>
      {testBanner}

      <Button size="lg" className="w-full sm:w-auto" onClick={() => setStage("address")} data-testid="button-order-prints">
        <Package aria-hidden /> Continue to shipping
      </Button>
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`ship-${id}`}>{label}</Label>
      {children}
      {hint && <p id={`hint-${id}`} className="text-sm text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`err-${id}`} className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, action }: { label: React.ReactNode; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3">
      <dt className="w-24 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
      {action}
    </div>
  );
}

function SuggestedAddress({
  entered,
  suggested,
  onUse,
  onKeep,
}: {
  entered: ShippingAddressInput;
  suggested: NonNullable<Quote["suggestedAddress"]>;
  onUse: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-primary/40 p-4" role="group" aria-label="Check your address">
      <p className="font-medium">The post office suggests a small change to the address.</p>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground">You entered</p>
          <p>{entered.street1}{entered.street2 ? `, ${entered.street2}` : ""}<br />{entered.city}, {entered.state_code} {entered.postcode}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Suggested</p>
          <p>{suggested.street1}{suggested.street2 ? `, ${suggested.street2}` : ""}<br />{suggested.city}, {suggested.state_code} {suggested.postcode}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onUse}>Use suggested</Button>
        <Button variant="outline" onClick={onKeep}>Keep what I entered</Button>
      </div>
    </div>
  );
}

function OrderStatusCard({ orderId, status, heading }: { orderId: string; status: string | null; heading: string }) {
  // Lulu checks the files within a minute or so of an order, so look on
  // load and keep looking while it's still new
  const live = useQuery<{ status: string; problem?: string | null; estimatedShipping?: { arrival_min: string; arrival_max: string } }>({
    queryKey: ["/api/print/orders", orderId, "status"],
    refetchInterval: (q) => (["CREATED", "UNPAID", "PAYMENT_IN_PROGRESS", undefined].includes((q.state.data as any)?.status ?? undefined) ? 30_000 : false),
  });
  const current = live.data?.status ?? status;
  const arrival = live.data?.estimatedShipping;
  const range = useMemo(
    () => (arrival?.arrival_min && arrival?.arrival_max ? formatDateRange(arrival.arrival_min.slice(0, 10), arrival.arrival_max.slice(0, 10)) : ""),
    [arrival],
  );
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center" data-testid="order-status-card">
      <Package className="h-6 w-6 shrink-0 text-primary" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{heading}: #{orderId}</p>
        <p className="text-sm">
          {orderStatusLabel(current)}
          {range ? ` · arrives about ${range}` : ""}
        </p>
        {current === "REJECTED" && (
          // This is a past order: ordering again makes new files from the
          // book as it is now, so it's a note, not an alarm
          <div className="mt-1 space-y-1 text-sm text-muted-foreground" data-testid="order-rejected">
            <p>
              The printer couldn't use the files for that order, so it wasn't printed and nothing was charged.
              Ordering again makes new files from your book as it is now.
            </p>
            {live.data?.problem && (
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-primary">The printer's reason</summary>
                <p className="mt-1">{live.data.problem}</p>
              </details>
            )}
          </div>
        )}
        {live.isError && <p className="text-sm text-destructive">Couldn't get the latest status. Try again in a moment.</p>}
      </div>
      <Button variant="outline" onClick={() => live.refetch()} disabled={live.isFetching}>
        <RefreshCw className={live.isFetching ? "animate-spin" : ""} aria-hidden /> Check status
      </Button>
    </div>
  );
}

// Follows one order from "Place order" to the door. Polls quickly while the
// book is being prepared or paid for, then slowly while it's at the printer.
function OrderTracker({ orderId, returnedCanceled, email, onStartOver }: {
  orderId: string;
  returnedCanceled: boolean;
  email?: string;
  onStartOver: () => void;
}) {
  const { data: order, isError, refetch } = useQuery<PrintOrderView>({
    queryKey: ["/api/print-orders", orderId],
    refetchInterval: (q) => {
      const o = q.state.data as PrintOrderView | undefined;
      if (!o || o.status === "preparing" || o.status === "paid") return 2000;
      if (o.status === "awaiting_payment") return returnedCanceled ? false : 3000;
      if (o.status === "submitted" && ["CREATED", "UNPAID", "PAYMENT_IN_PROGRESS", null].includes(o.luluStatus)) return 30_000;
      return false;
    },
  });
  // Off to Stripe's checkout as soon as it's ready (not after coming back from it)
  const redirected = useRef(false);
  useEffect(() => {
    if (order?.status === "awaiting_payment" && order.checkoutUrl && !returnedCanceled && !redirected.current) {
      redirected.current = true;
      window.location.assign(order.checkoutUrl);
    }
  }, [order, returnedCanceled]);
  useEffect(() => {
    if (order?.status === "submitted") queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
  }, [order?.status]);

  if (isError) return <ErrorState title="Couldn't load your order" description="Check your connection and try again." onRetry={() => refetch()} />;
  if (!order || order.status === "preparing") {
    return (
      <Notice icon="busy" title="Getting your book ready to print…">
        This takes about a minute for a big book. Please keep this page open; you'll go to secure checkout next.
      </Notice>
    );
  }
  if (order.status === "awaiting_payment") {
    return returnedCanceled ? (
      <Notice icon="info" title="Payment wasn't finished" actions={<>
        {order.checkoutUrl && <Button onClick={() => window.location.assign(order.checkoutUrl!)}>Go back to checkout</Button>}
        <Button variant="outline" onClick={onStartOver}>Start over</Button>
      </>}>
        Nothing was charged and nothing was printed.
      </Notice>
    ) : (
      <Notice icon="busy" title="Taking you to secure checkout…">
        Payment is handled by Stripe.{" "}
        {order.checkoutUrl && <a className="text-primary underline" href={order.checkoutUrl}>Continue to checkout</a>}
      </Notice>
    );
  }
  if (order.status === "paid") {
    return <Notice icon="busy" title="Payment received. Sending your book to the printer…">This takes a few seconds.</Notice>;
  }
  if (order.status === "submitted") {
    const shipped = order.luluStatus === "SHIPPED";
    return (
      <div className="space-y-3" data-testid="order-confirmation">
        <Notice icon="done" title={shipped ? "Your book has shipped" : "Your book is ordered"}>
          <span className="block">Order #{order.luluOrderId} · {order.quantity} {order.quantity === 1 ? "copy" : "copies"}{order.priceCents != null ? ` · ${money(order.priceCents / 100)}` : ""}</span>
          <span className="block">{orderStatusLabel(order.luluStatus)}{order.arrival ? ` · arrives about ${formatDateRange(order.arrival.min, order.arrival.max)}` : ""}</span>
          <span className="block text-sm text-muted-foreground">Your receipt goes to {order.contactEmail || email}.</span>
        </Notice>
        <Tracking tracking={order.tracking} />
        <Button variant="outline" onClick={onStartOver}>Order more copies</Button>
      </div>
    );
  }
  // failed, refunded or canceled
  return (
    <Notice icon="problem" title={order.status === "canceled" ? "Checkout ended" : "This order didn't go through"} actions={<Button onClick={onStartOver}>Try again</Button>}>
      {order.problem || (order.refunded ? "Your payment was refunded." : "Nothing was charged.")}
    </Notice>
  );
}

function Tracking({ tracking }: { tracking: PrintOrderView["tracking"] }) {
  if (!tracking?.length) return null;
  return (
    <ul className="space-y-1 text-sm">
      {tracking.map((t, i) => (
        <li key={i}>
          {t.carrier ? `${t.carrier} ` : ""}tracking{t.number ? ` ${t.number}` : ""}
          {t.url && <> · <a className="text-primary underline" href={t.url} target="_blank" rel="noreferrer">Track the package</a></>}
        </li>
      ))}
    </ul>
  );
}

function Notice({ icon, title, children, actions }: { icon: "busy" | "done" | "info" | "problem"; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  const tone = icon === "done" ? "border-green-700/30 bg-green-50 dark:bg-green-950/30" : icon === "problem" ? "border-destructive/50" : "";
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-4", tone)} role="status">
      {icon === "busy" ? <Loader2 className="mt-0.5 h-6 w-6 shrink-0 animate-spin text-primary" aria-hidden />
        : icon === "done" ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-700 dark:text-green-400" aria-hidden />
        : icon === "problem" ? <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" aria-hidden />
        : <Package className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />}
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children && <div className="text-base">{children}</div>}
        {actions && <div className="flex flex-wrap gap-2 pt-2">{actions}</div>}
      </div>
    </div>
  );
}

// Orders for this book that reached the printer (or were refunded), newest first
function OrderHistory({ cookbookId, legacy }: { cookbookId: number; legacy: { id: string; status: string | null } | null }) {
  const { data } = useQuery<{ orders: PrintOrderView[] }>({ queryKey: ["/api/cookbooks", cookbookId, "print-orders"] });
  const orders = (data?.orders ?? []).filter((o) => o.status === "submitted" || o.status === "refunded");
  if (!orders.length) {
    return legacy ? <OrderStatusCard orderId={legacy.id} status={legacy.status} heading="Your earlier order" /> : null;
  }
  return (
    <section aria-labelledby="your-orders" className="rounded-lg border">
      <h2 id="your-orders" className="border-b p-3 font-semibold">Your orders</h2>
      <ul className="divide-y">
        {orders.slice(0, 5).map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
            <span className="font-medium">{new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <span>{o.quantity} {o.quantity === 1 ? "copy" : "copies"}{o.priceCents != null ? ` · ${money(o.priceCents / 100)}` : ""}</span>
            <span className="text-muted-foreground">{o.status === "refunded" ? "Refunded" : orderStatusLabel(o.luluStatus)}</span>
            {o.tracking?.[0]?.url && <a className="text-primary underline" href={o.tracking[0].url} target="_blank" rel="noreferrer">Track</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}
