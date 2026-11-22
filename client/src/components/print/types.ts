import type { PrintLayoutData } from "@shared/schema";
import type {
  TrimSizeId,
  BindingTypeId,
  PaperTypeId,
  ColorTypeId,
  CoverFinishId,
} from "@/lib/print-constants";

export type TemplateStyle = "classic" | "modern" | "rustic" | "elegant" | "card" | "heirloom";

/** Everything the print builder autosaves to the print project */
export interface BookDraft {
  layoutData: PrintLayoutData;
  templateStyle: TemplateStyle;
  customTemplateId: number | null;
  trimSize: TrimSizeId;
  bindingType: BindingTypeId;
  paperType: PaperTypeId;
  colorType: ColorTypeId;
  coverFinish: CoverFinishId;
}

export interface RecipeSummary {
  id: string;
  title: string;
  dishImageThumbnail: string | null;
  /** Has both its own directions and Grammie's fuller steps */
  hasOriginalSteps?: boolean;
}

export interface Section {
  id: string;
  title: string;
  recipeIds: string[];
}

export const STEPS = [
  { id: "book", label: "Book", title: "Pick your book" },
  { id: "cover", label: "Cover", title: "Design the cover" },
  { id: "pages", label: "Pages", title: "Fill the pages" },
  { id: "order", label: "Order", title: "Review and order" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

/** Old links (and Stripe's return URL) used the five-step names */
const LEGACY_STEPS: Record<string, StepId> = {
  look: "book",
  personalize: "cover",
  recipes: "pages",
  review: "order",
};

export function isStepId(v: string | null | undefined): v is StepId {
  return STEPS.some((s) => s.id === v);
}

/** A step from the URL, mapping the old names to the new steps */
export function stepFromParam(v: string | null | undefined): StepId | null {
  if (isStepId(v)) return v;
  return v && LEGACY_STEPS[v] ? LEGACY_STEPS[v] : null;
}
