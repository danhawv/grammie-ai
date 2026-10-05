import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Eye, Info, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/page-states";
import { apiRequest } from "@/lib/queryClient";
import { downscaleImage } from "@/lib/images";
import { useToast } from "@/hooks/use-toast";
import { lintIngredients, type NormalizedIngredientLike } from "@shared/ingredient-lint";
import type { ReadinessItem, ReadinessResult } from "@shared/print-readiness";
import type { FamilyPhotoEntry, PrintLayoutData } from "@shared/schema";
import type { BookDraft, StepId } from "./types";

// "Ready to print?" (replaces the old Review and Preflight panels): one
// plain-language list, split into "Needs attention" (would print wrong) and
// "Worth a look" (prints fine), each with a one-tap fix where there is one.

/** Family photos smaller than this on the long side may print blurry */
const LOW_RES_FAMILY_PHOTO_PX = 900;

interface Finding {
  key: string;
  level: "attention" | "look";
  text: string;
  names?: { label: string; href?: string }[];
  actions: { label: string; onClick: () => void; primary?: boolean; busy?: boolean }[];
}

interface ReadyToPrintProps {
  cookbookId: number;
  draft: BookDraft;
  updateLayout: (change: Partial<PrintLayoutData>, undoMessage?: string) => void;
  goToStep: (step: StepId) => void;
  onOpenPreview: () => void;
  onReviewIngredients: () => void;
  onResult?: (attentionCount: number) => void;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function useDismissed(cookbookId: number) {
  const storageKey = `print-ready-dismissed-${cookbookId}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
    } catch {
      return new Set();
    }
  });
  const dismiss = (key: string) =>
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* private mode */ }
      return next;
    });
  return { dismissed, dismiss };
}

export function ReadyToPrint({ cookbookId, draft, updateLayout, goToStep, onOpenPreview, onReviewIngredients, onResult }: ReadyToPrintProps) {
  const { toast } = useToast();
  const layout = draft.layoutData;
  const { dismissed, dismiss } = useDismissed(cookbookId);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<FamilyPhotoEntry | null>(null);

  const check = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/preflight`, {
        layoutData: layout,
        trimSize: draft.trimSize,
        bindingType: draft.bindingType,
      });
      return (await res.json()) as ReadinessResult;
    },
  });

  // Check on arrival, and again when the recipes, chapters or book change
  const signature = JSON.stringify([layout.sections, layout.title, layout.authorName, draft.trimSize, draft.bindingType]);
  useEffect(() => {
    check.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Ingredient lines that would print oddly (AI clean-up leftovers)
  const { data: printRecipes } = useQuery<{ recipes: { id: string; title: string; normalizedIngredients: NormalizedIngredientLike[] | null }[] }>({
    queryKey: ["/api/cookbooks", cookbookId, "recipes", "print"],
  });
  const inBook = useMemo(() => new Set(layout.sections.flatMap((s) => s.recipeIds)), [layout.sections]);
  const ingredientIssueCount = useMemo(
    () => (printRecipes?.recipes ?? []).filter((r) => inBook.has(r.id)).reduce((n, r) => n + lintIngredients(r.normalizedIngredients).length, 0),
    [printRecipes, inBook],
  );

  const removeRecipes = (ids: string[], message: string) => {
    const drop = new Set(ids);
    updateLayout({ sections: layout.sections.map((s) => ({ ...s, recipeIds: s.recipeIds.filter((id) => !drop.has(id)) })) }, message);
  };

  const replacePhoto = async (old: FamilyPhotoEntry, file: File) => {
    try {
      const form = new FormData();
      form.append("photos", await downscaleImage(file), file.name.replace(/\.\w+$/, "") + ".jpg");
      const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/photos`, form);
      const body = (await res.json()) as { added: FamilyPhotoEntry[] };
      const added = body.added[0];
      if (!added) throw new Error("not read");
      // The new photo takes the old one's place in the book
      updateLayout({
        familyPhotos: (layout.familyPhotos ?? []).map((p) =>
          p.id === old.id ? { ...added, placement: old.placement, pinnedRecipeId: old.pinnedRecipeId } : p,
        ),
      });
      apiRequest("DELETE", `/api/cookbook-photos/${old.id}`).catch(() => {});
      toast({ title: "Photo replaced" });
    } catch {
      toast({ title: "Couldn't use that photo", description: "Try a JPG or PNG photo.", variant: "destructive" });
    } finally {
      setReplacing(null);
    }
  };

  const findings: Finding[] = useMemo(() => {
    const out: Finding[] = [];
    const r = check.data;
    const recipeName = (id: string, title: string) => ({ label: title, href: `/recipe/${id}` });

    for (const item of r?.items ?? []) {
      const key = item.code;
      const names = (item.ids ?? []).map((id, i) => recipeName(id, item.names?.[i] ?? "Recipe"));
      const n = item.count ?? 0;
      const f = describe(item, n, names, r!);
      if (f) out.push({ key, level: item.level, ...f });
    }

    // Family photos
    const photos = layout.familyPhotos ?? [];
    const unplaced = photos.filter((p) => p.placement?.type === "unplaced");
    const notYet = photos.filter((p) => !p.placement);
    if (unplaced.length) {
      out.push({
        key: "photos_unplaced",
        level: "look",
        text: `${unplaced.length} family ${plural(unplaced.length, "photo doesn't", "photos don't")} fit under any recipe, so ${plural(unplaced.length, "it", "they")} won't print yet.`,
        actions: [{
          label: "Add to the Family Album",
          primary: true,
          onClick: () => updateLayout({
            familyPhotos: photos.map((p) => (p.placement?.type === "unplaced" ? { ...p, pinnedRecipeId: undefined, placement: { type: "album" as const } } : p)),
          }),
        }],
      });
    }
    if (notYet.length) {
      out.push({
        key: "photos_not_placed",
        level: "look",
        text: `${notYet.length} family ${plural(notYet.length, "photo isn't", "photos aren't")} placed in the book yet.`,
        actions: [{ label: "Go to photos", onClick: () => goToStep("personalize") }],
      });
    }
    for (const p of photos) {
      if (Math.max(p.width, p.height) >= LOW_RES_FAMILY_PHOTO_PX || dismissed.has(`photo:${p.id}`)) continue;
      if (p.placement?.type === "unplaced" || !p.placement) continue;
      out.push({
        key: `photo:${p.id}`,
        level: "look",
        text: "This family photo is small and may print blurry.",
        names: [{ label: `${p.width} × ${p.height} pixels` }],
        actions: [
          { label: "Replace", primary: true, busy: replacing?.id === p.id, onClick: () => { setReplacing(p); replaceRef.current?.click(); } },
          { label: "Use anyway", onClick: () => dismiss(`photo:${p.id}`) },
        ],
      });
    }

    if (ingredientIssueCount > 0) {
      out.push({
        key: "ingredients",
        level: "look",
        text: `${ingredientIssueCount} ingredient ${plural(ingredientIssueCount, "line looks", "lines look")} odd and may print wrong, like “24 cookies Oreo cookies”.`,
        actions: [{ label: "Check the amounts", primary: true, onClick: onReviewIngredients }],
      });
    }

    return out.filter((f) => !dismissed.has(f.key));

    function describe(item: ReadinessItem, n: number, names: { label: string; href?: string }[], res: ReadinessResult): Omit<Finding, "key" | "level"> | null {
      switch (item.code) {
        case "no_recipes":
          return { text: "There are no recipes in the book yet.", actions: [{ label: "Add recipes", primary: true, onClick: () => goToStep("recipes") }] };
        case "recipes_missing":
          return {
            text: `${n} ${plural(n, "recipe", "recipes")} in the book can't be found. ${plural(n, "It was", "They were")} deleted or ${plural(n, "is", "are")} no longer shared with you, so ${plural(n, "it", "they")} would be left out.`,
            actions: [{ label: plural(n, "Take it out", "Take them out"), primary: true, onClick: () => removeRecipes(item.ids ?? [], "Took missing recipes out") }],
          };
        case "still_processing":
          return { text: `Grammie is still reading ${n} ${plural(n, "recipe", "recipes")}. Wait a minute, then check again.`, names, actions: [{ label: "Check again", onClick: () => check.mutate() }] };
        case "processing_failed":
          return {
            text: `${n} ${plural(n, "recipe", "recipes")} couldn't be read, so ${plural(n, "it", "they")} would print mostly empty.`,
            names,
            actions: [{ label: plural(n, "Take it out", "Take them out"), onClick: () => removeRecipes(item.ids ?? [], "Took recipes out of the book") }],
          };
        case "no_ingredients":
          return {
            text: `${n} ${plural(n, "recipe has", "recipes have")} no ingredients listed. Open ${plural(n, "it", "each one")} to add them, or take ${plural(n, "it", "them")} out of the book.`,
            names,
            actions: [{ label: plural(n, "Take it out", "Take them out"), onClick: () => removeRecipes(item.ids ?? [], "Took recipes out of the book") }],
          };
        case "no_instructions":
          return {
            text: `${n} ${plural(n, "recipe has", "recipes have")} no steps. Open ${plural(n, "it", "each one")} to add them, or take ${plural(n, "it", "them")} out of the book.`,
            names,
            actions: [{ label: plural(n, "Take it out", "Take them out"), onClick: () => removeRecipes(item.ids ?? [], "Took recipes out of the book") }],
          };
        case "empty_chapter":
          return {
            text: `${plural(n, "A chapter has", `${n} chapters have`)} no recipes and would print as an empty title page.`,
            names: (item.names ?? []).map((label) => ({ label })),
            actions: [{
              label: plural(n, "Remove it", "Remove them"),
              primary: true,
              onClick: () => updateLayout({ sections: layout.sections.filter((s) => !(item.ids ?? []).includes(s.id)) }, "Removed empty chapters"),
            }],
          };
        case "too_many_pages":
          return {
            text: `The book is about ${n} pages, more than this binding can hold (${res.maxPages}). Choose another binding, or take some recipes out.`,
            actions: [{ label: "Change binding", primary: true, onClick: () => goToStep("look") }],
          };
        case "photo_low_res":
          return {
            text: `${n} recipe ${plural(n, "photo is", "photos are")} small and may print blurry. Open the recipe to choose a bigger photo.`,
            names,
            actions: [{ label: "Use anyway", onClick: () => dismiss("photo_low_res") }],
          };
        case "photo_missing":
          return {
            text: `${n} ${plural(n, "recipe has", "recipes have")} no photo. ${plural(n, "It", "They")}'ll print with the title and recipe only.`,
            names,
            actions: [{ label: "That's fine", onClick: () => dismiss("photo_missing") }],
          };
        case "book_title_missing":
          return { text: "The book doesn't have a title yet.", actions: [{ label: "Add a title", primary: true, onClick: () => goToStep("personalize") }] };
        case "author_missing":
          return {
            text: "There's no author name for the cover.",
            actions: [{ label: "Add a name", onClick: () => goToStep("personalize") }, { label: "Leave it off", onClick: () => dismiss("author_missing") }],
          };
        case "near_page_limit":
          return { text: `The book is about ${n} pages, close to this binding's limit of ${res.maxPages}.`, actions: [{ label: "OK", onClick: () => dismiss("near_page_limit") }] };
        case "pages_padded":
          return {
            text: `The book is about ${res.estimatedPages} pages. Printed books need at least ${res.minPages}, so about ${n} blank “Notes” pages are added at the end — handy for writing in new recipes.`,
            actions: [{ label: "OK", onClick: () => dismiss("pages_padded") }],
          };
        default:
          return null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.data, layout, dismissed, ingredientIssueCount, replacing]);

  const attention = findings.filter((f) => f.level === "attention");
  const look = findings.filter((f) => f.level === "look");

  useEffect(() => {
    if (check.data) onResult?.(attention.length);
  }, [check.data, attention.length, onResult]);

  return (
    <div className="space-y-6" data-testid="ready-to-print">
      <input
        ref={replaceRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && replacing) void replacePhoto(replacing, file);
          else setReplacing(null);
        }}
      />

      {check.isPending && !check.data ? (
        <div className="flex items-center gap-3 rounded-lg border p-4" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          <span>Checking every recipe and photo…</span>
        </div>
      ) : check.isError ? (
        <ErrorState title="Couldn't check the book" description="Check your connection and try again." onRetry={() => check.mutate()} />
      ) : check.data ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center" role="status">
          {attention.length === 0 ? (
            <CheckCircle2 className="h-6 w-6 shrink-0 text-green-700 dark:text-green-400" aria-hidden />
          ) : (
            <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" aria-hidden />
          )}
          <div className="flex-1">
            <p className="font-semibold">
              {attention.length === 0
                ? "Your book is ready to print."
                : `${attention.length} ${plural(attention.length, "thing needs", "things need")} attention before printing.`}
            </p>
            <p className="text-sm text-muted-foreground">
              {check.data.totalRecipes} {plural(check.data.totalRecipes, "recipe", "recipes")}, about {Math.max(check.data.estimatedPages, check.data.minPages)} pages.
              Look through the preview before you order.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onOpenPreview}>
              <Eye aria-hidden /> Preview
            </Button>
            <Button variant="ghost" onClick={() => check.mutate()} disabled={check.isPending}>
              <RefreshCw className={check.isPending ? "animate-spin" : ""} aria-hidden /> Check again
            </Button>
          </div>
        </div>
      ) : null}

      {attention.length > 0 && <FindingList title="Needs attention" icon="attention" findings={attention} />}
      {look.length > 0 && <FindingList title="Worth a look" icon="look" findings={look} />}
    </div>
  );
}

function FindingList({ title, icon, findings }: { title: string; icon: "attention" | "look"; findings: Finding[] }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {icon === "attention" ? <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden /> : <Info className="h-5 w-5 text-muted-foreground" aria-hidden />}
        {title}
      </h2>
      <ul className="space-y-3">
        {findings.map((f) => (
          <li key={f.key} className={`rounded-lg border p-4 ${f.level === "attention" ? "border-destructive/50" : ""}`}>
            <p className="text-base">{f.text}</p>
            {f.names && f.names.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {f.names.slice(0, 8).map((n, i) => (
                  <li key={i}>
                    {n.href ? (
                      <Link href={n.href} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
                        {n.label}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{n.label}</span>
                    )}
                  </li>
                ))}
                {f.names.length > 8 && <li className="text-muted-foreground">and {f.names.length - 8} more</li>}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {f.actions.map((a) => (
                <Button key={a.label} variant={a.primary ? "secondary" : "outline"} onClick={a.onClick} disabled={a.busy}>
                  {a.busy && <Loader2 className="animate-spin" aria-hidden />}
                  {a.label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
