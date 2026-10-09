import { PageHeader } from "@/components/page-header";

// Plain-language terms for printed books, linked from checkout. Printing and
// shipping are done by Lulu; payment by Stripe.
export default function PrintPolicy() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader title="Printed books: ordering, refunds and returns" />
      <div className="space-y-6 text-base leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">How it works</h2>
          <p>
            Each book is printed to order by our printing partner, Lulu, and shipped straight to you. Printing takes a few
            business days; the shipping option you choose sets how long delivery takes after that. You pay on Stripe's
            secure checkout page, and the price you see includes printing, shipping and tax.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Check before you order</h2>
          <p>
            Your book is printed exactly as it looks in the preview, so look through every page first: recipes, photos,
            spelling and the cover. Because each book is made just for you, we can't take back a book for changes you'd
            like to make after it's printed.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">If the printer can't print it</h2>
          <p>
            Every order is checked by the printer. If it can't print your book, the order stops and your payment is
            refunded in full, automatically. Refunds reach your card in about 5 to 10 business days.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Damaged or misprinted books</h2>
          <p>
            If a book arrives damaged, or isn't printed the way it looked in the preview (pages missing, out of order,
            badly cut or smudged), contact us within 30 days of delivery with your order number and a photo. We'll
            reprint it or refund it, at no cost to you.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Canceling</h2>
          <p>
            Printing starts soon after you pay. If you need to cancel, contact us right away: we can cancel and refund
            an order as long as the printer hasn't started on it.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p>
            Email <a className="text-primary underline" href="mailto:support@grammie.ai">support@grammie.ai</a> with your
            order number.
          </p>
        </section>
      </div>
    </div>
  );
}
