import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { BINDING_PAGE_LIMITS, type BindingTypeId, type ColorTypeId, type CoverFinishId, type PaperTypeId, type TrimSizeId } from "@/lib/print-constants";
import { DEFAULT_SHIPPING_LEVEL } from "@shared/print-checkout";

// "About $X" for a book, delivered by standard mail to a typical US address.
// Shares its cache with the order step's estimate (same query key), so the
// price in the bottom bar and on the order step always agree.

export interface BookSpec {
  trimSize: TrimSizeId;
  bindingType: BindingTypeId;
  paperType: PaperTypeId;
  colorType: ColorTypeId;
  coverFinish: CoverFinishId;
}

export interface PrintEstimate {
  totalCost: number;
  printCost: number;
  shippingCost: number;
  currency: string;
  pageCount: number;
}

interface LuluStatus {
  configured: boolean;
  testMode?: boolean;
}

export function useLuluStatus() {
  return useQuery<LuluStatus>({ queryKey: ["/api/print/lulu/status"], staleTime: 60_000 });
}

/** Whether a book of this many pages fits the binding, and if not why */
export function bindingFit(bindingType: BindingTypeId, pageCount: number): string | null {
  const limits = BINDING_PAGE_LIMITS[bindingType];
  if (!limits) return null;
  if (pageCount > limits.max) return `Holds up to ${limits.max} pages; this book is about ${pageCount}.`;
  return null;
}

export function usePrintEstimate(cookbookId: number, pageCount: number, spec: BookSpec, enabled = true) {
  const status = useLuluStatus();
  const fits = !bindingFit(spec.bindingType, pageCount);
  return useQuery<PrintEstimate>({
    queryKey: [
      "/api/print/lulu/calculate-price", "estimate", cookbookId, 1, pageCount,
      spec.trimSize, spec.bindingType, spec.paperType, spec.colorType, spec.coverFinish,
    ],
    queryFn: async () =>
      (await apiRequest("POST", "/api/print/lulu/calculate-price", {
        cookbookId,
        pageCount,
        quantity: 1,
        shippingLevel: DEFAULT_SHIPPING_LEVEL,
        ...spec,
      })).json(),
    enabled: enabled && !!status.data?.configured && pageCount > 0 && fits,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function formatPrice(amount: number | undefined, currency = "USD"): string {
  if (amount == null || !Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.ceil(amount));
}
