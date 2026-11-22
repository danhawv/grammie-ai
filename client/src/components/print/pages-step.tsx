import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FamilyPhotosPanel } from "@/components/family-photos-panel";
import { cn } from "@/lib/utils";
import type { FamilyPhotoEntry, PrintLayoutData } from "@shared/schema";
import type { BookDraft } from "./types";

// Step 3: what's inside. The recipes and chapters come first (the
// RecipesStep list is passed in), then the personal pages, then the
// printing details nobody needs to touch.

interface PagesStepProps {
  cookbookId: number;
  draft: BookDraft;
  recipes: ReactNode;
  updateLayout: (change: Partial<PrintLayoutData>) => void;
  updateCustomization: (field: string, value: unknown) => void;
  recipeTitles: Map<string, string>;
}

export function PagesStep({ cookbookId, draft, recipes, updateLayout, updateCustomization, recipeTitles }: PagesStepProps) {
  const l = draft.layoutData;
  const c = l.customizations;
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <div className="space-y-10">
      <section aria-labelledby="recipes-heading" className="space-y-3">
        <h3 id="recipes-heading" className="text-lg font-semibold">Recipes and chapters</h3>
        {recipes}
      </section>

      <section aria-labelledby="personal-heading" className="space-y-4">
        <div>
          <h3 id="personal-heading" className="text-lg font-semibold">Make it personal</h3>
          <p className="text-sm text-muted-foreground">The pages that make it your family's book.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dedication">Dedication <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea
            id="dedication"
            placeholder="e.g. For Grandma, who taught us all to cook"
            value={l.dedication || ""}
            onChange={(e) => updateLayout({ dedication: e.target.value })}
            className="resize-y text-base"
            rows={3}
            data-testid="input-dedication"
          />
          <p className="text-sm text-muted-foreground">Gets its own page at the front of the book. Giving it as a gift? This is the place for your note.</p>
        </div>
        <FamilyPhotosPanel
          cookbookId={cookbookId}
          layoutData={l}
          onChange={(familyPhotos: FamilyPhotoEntry[]) => updateLayout({ familyPhotos })}
          templateStyle={draft.templateStyle}
          customTemplateId={draft.customTemplateId}
          trimSize={draft.trimSize}
          bindingType={draft.bindingType}
          recipeTitles={recipeTitles}
        />
      </section>

      <section className="rounded-lg border">
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((o) => !o)}
        >
          <span>
            <span className="block font-medium">Page details</span>
            <span className="block text-sm text-muted-foreground">Measurements, directions, nutrition and tips</span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", optionsOpen && "rotate-180")} aria-hidden />
        </button>
        {optionsOpen && (
          <div className="grid grid-cols-1 gap-5 border-t p-4 sm:grid-cols-2">
            <NativeSelect
              id="units"
              label="Measurements"
              value={c?.unitSystem || "original"}
              hint="Print every recipe in one measuring system."
              onChange={(v) => updateCustomization("unitSystem", v)}
              options={[
                { value: "original", label: "As written in each recipe" },
                { value: "us", label: "US (cups, oz, lb)" },
                { value: "metric", label: "Metric (g, ml)" },
              ]}
              testId="select-unit-system"
            />
            <NativeSelect
              id="steps-version"
              label="Directions"
              value={c?.stepsVersion || "improved"}
              hint="Where a recipe's own directions were brief, Grammie wrote fuller steps. You can change single recipes in the list above."
              onChange={(v) => updateCustomization("stepsVersion", v)}
              options={[
                { value: "improved", label: "Fuller steps by Grammie" },
                { value: "original", label: "As written on the original" },
              ]}
              testId="select-steps-version"
            />
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="font-medium">Extra pages after each recipe</legend>
              <p className="text-sm text-muted-foreground">Only for recipes that have them, so the recipe page stays clean.</p>
              <ToggleRow id="show-nutrition" label="Nutrition (estimated)" checked={c?.showNutrition === true} onChange={(v) => updateCustomization("showNutrition", v)} />
              <ToggleRow id="show-tips" label="Tips" checked={c?.showTips === true} onChange={(v) => updateCustomization("showTips", v)} />
              <ToggleRow id="show-variations" label="Variations" checked={c?.showVariations === true} onChange={(v) => updateCustomization("showVariations", v)} />
              <ToggleRow id="show-page-numbers" label="Page numbers" checked={c?.showPageNumbers !== false} onChange={(v) => updateCustomization("showPageNumbers", v)} />
            </fieldset>
          </div>
        )}
      </section>
    </div>
  );
}

function NativeSelect({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <Label htmlFor={id} className="text-base font-normal">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={`checkbox-${id.replace("show-", "")}`} />
    </div>
  );
}
