import { NativePurchases, PURCHASE_TYPE } from "@capgo/native-purchases";
import { registerStorePurchases, syncUnfinishedPurchases, type StorePurchases } from "@/lib/purchases";

// The App Store side of buying credits (lib/purchases.ts has the flow and
// talks to our server). StoreKit 2 through @capgo/native-purchases, with
// auto-finish off (capacitor.config.ts): a purchase is finished only after
// the server has added the credits.

const CREDITS_PREFIX = "ai.grammie.app.credits.";

const isCancel = (err: unknown) => /cancel/i.test(String((err as Error)?.message ?? err));
const isPending = (err: unknown) => /pending|deferred|ask to buy/i.test(String((err as Error)?.message ?? err));

const appStore: StorePurchases = {
  async purchase(productId, appAccountToken) {
    try {
      const tx = await NativePurchases.purchaseProduct({
        productIdentifier: productId,
        productType: PURCHASE_TYPE.INAPP,
        quantity: 1,
        appAccountToken,
        autoAcknowledgePurchases: false,
      });
      if (!tx.jwsRepresentation) throw new Error("The App Store didn't return a signed transaction");
      return { status: "purchased", jws: tx.jwsRepresentation, transactionId: tx.transactionId };
    } catch (err) {
      if (isCancel(err)) return { status: "cancelled" };
      if (isPending(err)) return { status: "pending" };
      throw err;
    }
  },
  async finish(transactionId) {
    await NativePurchases.finishTransaction({ transactionId });
  },
  async unfinished() {
    const { transactions } = await NativePurchases.getUnfinishedTransactions();
    return transactions
      .filter((t) => t.productIdentifier.startsWith(CREDITS_PREFIX) && t.jwsRepresentation)
      .map((t) => ({ jws: t.jwsRepresentation!, transactionId: t.transactionId }));
  },
  async prices(productIds) {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: productIds, productType: PURCHASE_TYPE.INAPP });
    return Object.fromEntries(products.map((p) => [p.identifier, p.priceString]));
  },
};

export async function startStore(): Promise<void> {
  registerStorePurchases(appStore);
  // Ask to Buy approvals and purchases made while the app was closed
  await NativePurchases.addListener("transactionUpdated", () => {
    void syncUnfinishedPurchases().catch(() => {});
  });
}
