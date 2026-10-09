import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, MoreHorizontal, Palette, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TemplateDesigner } from "@/components/template-designer";
import { TemplateFromPhotos } from "@/components/template-from-photos";
import { PrintDetailsNotice } from "@/components/print-details-notice";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";
import { cn } from "@/lib/utils";
import {
  BOOK_SIZES,
  BINDING_TYPES,
  PAPER_TYPES,
  COLOR_TYPES,
  COVER_FINISHES,
  BINDING_PAPER_COMPATIBILITY,
  BINDING_PAGE_LIMITS,
  type TrimSizeId,
  type BindingTypeId,
  type PaperTypeId,
  type ColorTypeId,
  type CoverFinishId,
} from "@/lib/print-constants";
import type { CustomTemplate } from "@shared/schema";
import type { BookDraft, TemplateStyle } from "./types";

// Step 2: how the book looks. Templates first (built-in, yours, from photos,
// or designed), then the physical book (size, binding, paper) and recipe
// page extras behind "Change".

const TEMPLATE_STYLES: { id: TemplateStyle; name: string; description: string }[] = [
  { id: "classic", name: "Classic", description: "Traditional cookbook pages with elegant type" },
  { id: "modern", name: "Modern", description: "Clean and simple, with bold photos" },
  { id: "rustic", name: "Rustic", description: "Warm and homey, with soft textures" },
  { id: "elegant", name: "Elegant", description: "Refined type and generous spacing" },
  { id: "card", name: "Recipe Card", description: "Photo beside the title, with nutrition and tips on every page" },
  { id: "heirloom", name: "Heirloom", description: "For family recipes: the dish photo next to the original handwritten card" },
];

interface LookStepProps {
  cookbookId: number;
  draft: BookDraft;
  update: (change: Partial<BookDraft>) => void;
  updateCustomization: (field: string, value: unknown) => void;
}

export function LookStep({ cookbookId, draft, update, updateCustomization }: LookStepProps) {
  const { toast } = useToast();
  const undoable = useUndoable();
  const { data: customTemplates = [] } = useQuery<CustomTemplate[]>({ queryKey: ["/api/templates"] });
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [designerOpen, setDesignerOpen] = useState(false);
  const [editing, setEditing] = useState<CustomTemplate | null>(null);
  const [bookOpen, setBookOpen] = useState(false);

  const { templateStyle, customTemplateId, trimSize, bindingType, paperType, colorType, coverFinish } = draft;
  const selectedCustom = customTemplates.find((t) => t.id === customTemplateId);
  const usesRecipeCardLayout = ((templateStyle === "card" || templateStyle === "heirloom") && !customTemplateId) || !!(selectedCustom?.templateData as any)?.layout;
  // Lulu only prints cream paper in black and white
  const compatiblePapers = (BINDING_PAPER_COMPATIBILITY[bindingType] || []).filter((p) => colorType === "BW" || p !== "060UC444");
  const limits = BINDING_PAGE_LIMITS[bindingType];
  const c = draft.layoutData.customizations;

  const deleteTemplate = (t: CustomTemplate) => {
    const wasSelected = customTemplateId === t.id;
    undoable({
      message: `Deleted “${t.name}”`,
      hide: () => {
        setHidden((prev) => new Set(prev).add(t.id));
        if (wasSelected) update({ customTemplateId: null });
      },
      restore: () => {
        setHidden((prev) => { const n = new Set(prev); n.delete(t.id); return n; });
        if (wasSelected) update({ customTemplateId: t.id });
      },
      commit: async () => {
        const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE", credentials: "include" });
        if (res.status === 409) {
          // Another cookbook uses it: keep it, and say why
          setHidden((prev) => { const n = new Set(prev); n.delete(t.id); return n; });
          toast({ title: `Kept “${t.name}”`, description: "Another cookbook uses this template, so it wasn't deleted." });
          return;
        }
        if (!res.ok && res.status !== 204) throw new Error("Delete failed");
        queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      },
    });
  };

  const visibleCustom = customTemplates.filter((t) => !hidden.has(t.id));

  return (
    <div className="space-y-8">
      <section aria-labelledby="templates-heading" className="space-y-3">
        <h2 id="templates-heading" className="text-xl font-semibold">Page style</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="list">
          {TEMPLATE_STYLES.map((style) => {
            const on = templateStyle === style.id && !customTemplateId;
            return (
              <li key={style.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ templateStyle: style.id, customTemplateId: null })}
                  className={cn("flex h-full w-full items-start gap-3 rounded-lg border p-4 text-left", on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50")}
                  data-testid={`template-${style.id}`}
                >
                  <span className="flex-1">
                    <span className="block font-medium">{style.name}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{style.description}</span>
                  </span>
                  {on && <Check className="h-5 w-5 shrink-0 text-primary" aria-label="Selected" />}
                </button>
              </li>
            );
          })}
        </ul>

        {visibleCustom.length > 0 && (
          <>
            <h3 className="flex items-center gap-2 pt-2 font-medium">
              <Palette className="h-4 w-4" aria-hidden /> Your templates
            </h3>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="list">
              {visibleCustom.map((t) => {
                const on = customTemplateId === t.id;
                return (
                  <li key={t.id} className={cn("flex items-start gap-1 rounded-lg border", on ? "border-primary bg-primary/5 ring-1 ring-primary" : "")}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => update({ customTemplateId: t.id })}
                      className="flex min-h-11 flex-1 items-start gap-3 rounded-lg p-4 text-left hover:bg-accent/50"
                    >
                      <span className="flex-1">
                        <span className="block font-medium">{t.name}</span>
                        {t.description && <span className="mt-1 block text-sm text-muted-foreground">{t.description}</span>}
                      </span>
                      {on && <Check className="h-5 w-5 shrink-0 text-primary" aria-label="Selected" />}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="m-1" aria-label={`Options for ${t.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditing(t); setDesignerOpen(true); }}>Edit template</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => deleteTemplate(t)} data-testid={`delete-template-${t.id}`}>
                          Delete template
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {usesRecipeCardLayout && <PrintDetailsNotice cookbookId={cookbookId} />}

        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
          <TemplateFromPhotos onCreated={(t) => update({ customTemplateId: t.id })} />
          <Button
            variant="outline"
            className="w-full"
            data-testid="design-custom-template"
            onClick={() => { setEditing(null); setDesignerOpen(true); }}
          >
            <Sparkles aria-hidden /> Design your own
          </Button>
        </div>
      </section>

      <section aria-labelledby="book-heading" className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="book-heading" className="text-xl font-semibold">The printed book</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {BOOK_SIZES[trimSize].width}″ × {BOOK_SIZES[trimSize].height}″ {BINDING_TYPES[bindingType].name.toLowerCase()},{" "}
              {COLOR_TYPES[colorType].name.toLowerCase()}, {COVER_FINISHES[coverFinish].name.toLowerCase()} cover
            </p>
          </div>
          <Button variant="outline" aria-expanded={bookOpen} onClick={() => setBookOpen((o) => !o)}>
            {bookOpen ? "Done" : "Change"} <ChevronDown className={cn("transition-transform", bookOpen && "rotate-180")} aria-hidden />
          </Button>
        </div>

        {bookOpen && (
          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            <NativeSelect
              id="trim-size"
              label="Book size"
              value={trimSize}
              onChange={(v) => update({ trimSize: v as TrimSizeId })}
              options={Object.entries(BOOK_SIZES).map(([id, s]) => ({ value: id, label: `${s.name} (${s.description})` }))}
              testId="select-trim-size"
            />
            <NativeSelect
              id="binding"
              label="Binding"
              value={bindingType}
              hint={`${BINDING_TYPES[bindingType].description} ${limits.min}–${limits.max} pages.`}
              onChange={(v) => {
                const bt = v as BindingTypeId;
                const compat = (BINDING_PAPER_COMPATIBILITY[bt] || []).filter((p) => colorType === "BW" || p !== "060UC444");
                update({ bindingType: bt, ...(compat.includes(paperType) ? {} : { paperType: compat[0] as PaperTypeId }) });
              }}
              // Linen wrap is hidden: Lulu makes it in only some sizes, and it
              // needs a cloth color and foil we don't ask for yet
              options={Object.entries(BINDING_TYPES).filter(([id]) => id !== "LW" || bindingType === "LW").map(([id, b]) => ({ value: id, label: b.name }))}
              testId="select-binding-type"
            />
            <NativeSelect
              id="paper"
              label="Paper"
              value={paperType}
              hint={PAPER_TYPES[paperType]?.description}
              onChange={(v) => update({ paperType: v as PaperTypeId })}
              options={compatiblePapers.map((id) => ({ value: id, label: PAPER_TYPES[id]?.name || id }))}
              testId="select-paper-type"
            />
            <NativeSelect
              id="color"
              label="Color"
              value={colorType}
              hint={COLOR_TYPES[colorType].description}
              onChange={(v) => update({ colorType: v as ColorTypeId, ...(v === "FC" && paperType === "060UC444" ? { paperType: "060UW444" as PaperTypeId } : {}) })}
              options={Object.entries(COLOR_TYPES).map(([id, x]) => ({ value: id, label: x.name }))}
              testId="select-color-type"
            />
            <NativeSelect
              id="finish"
              label="Cover finish"
              value={coverFinish}
              hint={COVER_FINISHES[coverFinish].description}
              onChange={(v) => update({ coverFinish: v as CoverFinishId })}
              options={Object.entries(COVER_FINISHES).map(([id, x]) => ({ value: id, label: x.name }))}
              testId="select-cover-finish"
            />
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

            <fieldset className="space-y-3 sm:col-span-2">
              <legend className="font-medium">Extra pages after each recipe</legend>
              <p className="text-sm text-muted-foreground">Shown only for recipes that have them, so the recipe page stays clean.</p>
              <ToggleRow id="show-nutrition" label="Nutrition (estimated)" checked={c?.showNutrition === true} onChange={(v) => updateCustomization("showNutrition", v)} />
              <ToggleRow id="show-tips" label="Tips" checked={c?.showTips === true} onChange={(v) => updateCustomization("showTips", v)} />
              <ToggleRow id="show-variations" label="Variations" checked={c?.showVariations === true} onChange={(v) => updateCustomization("showVariations", v)} />
              <ToggleRow id="show-page-numbers" label="Page numbers" checked={c?.showPageNumbers !== false} onChange={(v) => updateCustomization("showPageNumbers", v)} />
            </fieldset>
          </div>
        )}
      </section>

      <TemplateDesigner
        open={designerOpen}
        onOpenChange={setDesignerOpen}
        editingTemplate={editing}
        onSaved={(t) => update({ customTemplateId: t.id })}
      />
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

