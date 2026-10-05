import type { PrintLayoutData } from "@shared/schema";
import type {
  TrimSizeId,
  BindingTypeId,
  PaperTypeId,
  ColorTypeId,
  CoverFinishId,
} from "@/lib/print-constants";

export type TemplateStyle = "classic" | "modern" | "rustic" | "elegant" | "card";

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
}

export interface Section {
  id: string;
  title: string;
  recipeIds: string[];
}

export const STEPS = [
  { id: "recipes", label: "Recipes", title: "Recipes and chapters" },
  { id: "look", label: "Look", title: "Choose a look" },
  { id: "personalize", label: "Personalize", title: "Make it yours" },
  { id: "review", label: "Review", title: "Ready to print?" },
  { id: "order", label: "Order", title: "Order your book" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function isStepId(v: string | null | undefined): v is StepId {
  return STEPS.some((s) => s.id === v);
}
