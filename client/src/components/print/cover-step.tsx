import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ImageOff, ImagePlus, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downscale } from "@/components/family-photos-panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { mediaUrl } from "@/lib/platform";
import { privateImageUrl, useImagePass } from "@/lib/image-pass";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BOOK_SIZES } from "@/lib/print-constants";
import { coverPaletteFor, frontCoverHtml, type CoverPalette } from "@shared/cover-design";
import type { CustomTemplate, FamilyPhotoEntry, PrintLayoutData } from "@shared/schema";
import { CustomStyles } from "./look-step";
import { PrintDetailsNotice } from "@/components/print-details-notice";
import type { BookDraft, RecipeSummary, TemplateStyle } from "./types";

// Step 2: the cover, front and center. A live mockup of the real printed
// cover (same markup as the PDF), the words on it, a photo from the family's
// own pictures or cards, and the book's style shown as covers, not words.

export type CoverPhoto = NonNullable<NonNullable<PrintLayoutData["coverData"]>["photo"]>;

export const STYLES: { id: TemplateStyle; name: string; blurb: string }[] = [
  { id: "heirloom", name: "Heirloom", blurb: "Each dish beside its original handwritten card" },
  { id: "classic", name: "Classic", blurb: "Warm, traditional cookbook pages" },
  { id: "card", name: "Recipe card", blurb: "Photo beside the title, nutrition and tips" },
  { id: "rustic", name: "Rustic", blurb: "Homey, earthy tones" },
  { id: "modern", name: "Modern", blurb: "Clean type, bold photos" },
  { id: "elegant", name: "Elegant", blurb: "Refined type, generous space" },
];

/** Where a cover photo can be shown on screen */
export function coverPhotoSrc(cookbookId: number, photo: CoverPhoto | null | undefined, recipes: RecipeSummary[], pass: string | null): string | null {
  if (!photo) return null;
  if (photo.kind === "family") return privateImageUrl(`/api/cookbook-photos/${photo.id}`, pass);
  if (photo.kind === "card") return privateImageUrl(`/api/cookbooks/${cookbookId}/original-cards/${photo.id}`, pass);
  const r = recipes.find((x) => x.id === photo.id);
  return r?.dishImageThumbnail ? mediaUrl(r.dishImageThumbnail) ?? null : null;
}

/** The printed front cover, drawn from the same HTML the PDF uses */
export function CoverMockup({
  draft,
  palette,
  photoSrc,
  widthPx,
  className,
}: {
  draft: BookDraft;
  palette: CoverPalette;
  photoSrc: string | null;
  widthPx: number;
  className?: string;
}) {
  const size = BOOK_SIZES[draft.trimSize];
  const l = draft.layoutData;
  const html = useMemo(
    () =>
      frontCoverHtml({
        title: l.title || "",
        subtitle: l.subtitle,
        author: l.authorName,
        photoSrc,
        palette,
        widthIn: size.width,
        heightIn: size.height,
      }),
    [l.title, l.subtitle, l.authorName, photoSrc, palette, size.width, size.height],
  );
  const scale = widthPx / (size.width * 96);
  const heightPx = size.height * 96 * scale;
  const hard = draft.bindingType === "CW";
  const coil = draft.bindingType === "CO";
  return (
    <div className={cn("relative mx-auto", className)} style={{ width: widthPx, height: heightPx }} aria-hidden>
      <div
        className={cn("absolute inset-0 overflow-hidden shadow-[0_12px_28px_-8px_rgba(0,0,0,0.35),0_2px_6px_rgba(0,0,0,0.15)]", hard ? "rounded-[3px]" : "rounded-[2px]")}
      >
        <div style={{ width: size.width * 96, height: size.height * 96, transform: `scale(${scale})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: html }} />
        {/* Light from the left, and the hinge of a hardcover */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/25 via-white/10 to-transparent" />
        {hard && <div className="pointer-events-none absolute inset-y-0 left-[5%] w-px bg-black/20" />}
      </div>
      {coil && (
        <div className="absolute inset-y-[3%] -left-[3%] flex flex-col justify-between">
          {Array.from({ length: Math.max(8, Math.round(heightPx / 14)) }).map((_, i) => (
            <span key={i} className="block h-[5px] w-[12px] rounded-full border-2 border-zinc-500 bg-zinc-200" />
          ))}
        </div>
      )}
    </div>
  );
}

interface CoverStepProps {
  cookbookId: number;
  draft: BookDraft;
  allRecipes: RecipeSummary[];
  update: (change: Partial<BookDraft>) => void;
  updateLayout: (change: Partial<PrintLayoutData>) => void;
}

export function CoverStep({ cookbookId, draft, allRecipes, update, updateLayout }: CoverStepProps) {
  const l = draft.layoutData;
  const pass = useImagePass();
  const { data: customTemplates = [] } = useQuery<CustomTemplate[]>({ queryKey: ["/api/templates"] });
  const custom = draft.customTemplateId ? customTemplates.find((t) => t.id === draft.customTemplateId) : undefined;
  const palette = coverPaletteFor(draft.templateStyle, (custom?.templateData as any)?.cover ?? null);
  const photo = l.coverData?.photo ?? null;
  const photoSrc = coverPhotoSrc(cookbookId, photo, allRecipes, pass);
  const setPhoto = (p: CoverPhoto | null) => updateLayout({ coverData: { ...(l.coverData ?? {}), photo: p } });
  const [moreStyles, setMoreStyles] = useState(!!draft.customTemplateId);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-xl bg-gradient-to-b from-muted/60 to-muted px-8 py-6 sm:sticky sm:top-24">
          <CoverMockup draft={draft} palette={palette} photoSrc={photoSrc} widthPx={200} />
        </div>
        <div className="w-full flex-1 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="e.g. The Miller Family Kitchen" value={l.title || ""} onChange={(e) => updateLayout({ title: e.target.value })} data-testid="input-title" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subtitle">Subtitle <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="subtitle" placeholder="e.g. Recipes from three generations" value={l.subtitle || ""} onChange={(e) => updateLayout({ subtitle: e.target.value })} data-testid="input-subtitle" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author">By</Label>
            <Input id="author" autoComplete="name" placeholder="e.g. Grandma Jean and family" value={l.authorName || ""} onChange={(e) => updateLayout({ authorName: e.target.value })} data-testid="input-author" />
          </div>
        </div>
      </div>

      <CoverPhotoPicker cookbookId={cookbookId} draft={draft} allRecipes={allRecipes} selected={photo} onSelect={setPhoto} updateLayout={updateLayout} />

      <section aria-labelledby="style-heading" className="space-y-3">
        <div>
          <h3 id="style-heading" className="text-lg font-semibold">Style</h3>
          <p className="text-sm text-muted-foreground">Sets the cover colors and how every recipe page looks. Tap Preview to see the pages.</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="list">
          {STYLES.map((s) => {
            const on = draft.templateStyle === s.id && !draft.customTemplateId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ templateStyle: s.id, customTemplateId: null })}
                  className={cn(
                    "relative flex h-full w-full flex-col items-center gap-2 rounded-lg border p-3 text-center",
                    on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50",
                  )}
                  data-testid={`template-${s.id}`}
                >
                  <CoverMockup draft={draft} palette={coverPaletteFor(s.id)} photoSrc={photoSrc} widthPx={84} />
                  <span className="mt-1 font-medium">{s.name}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{s.blurb}</span>
                  {on && <Check className="absolute right-2 top-2 h-5 w-5 text-primary" aria-label="Selected" />}
                </button>
              </li>
            );
          })}
        </ul>
        {(((draft.templateStyle === "card" || draft.templateStyle === "heirloom") && !draft.customTemplateId) || !!(custom?.templateData as any)?.layout) && (
          <PrintDetailsNotice cookbookId={cookbookId} />
        )}
        <div className="rounded-lg border">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left"
            aria-expanded={moreStyles}
            onClick={() => setMoreStyles((o) => !o)}
          >
            <span>
              <span className="block font-medium">Your own styles</span>
              <span className="block text-sm text-muted-foreground">{custom ? `Using “${custom.name}”` : "Copy a cookbook you love from photos, or design one"}</span>
            </span>
            <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", moreStyles && "rotate-180")} aria-hidden />
          </button>
          {moreStyles && (
            <div className="border-t p-4">
              <CustomStyles cookbookId={cookbookId} draft={draft} update={update} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CoverPhotoPicker({
  cookbookId,
  draft,
  allRecipes,
  selected,
  onSelect,
  updateLayout,
}: {
  cookbookId: number;
  draft: BookDraft;
  allRecipes: RecipeSummary[];
  selected: CoverPhoto | null;
  onSelect: (p: CoverPhoto | null) => void;
  updateLayout: (change: Partial<PrintLayoutData>) => void;
}) {
  const pass = useImagePass();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const photosKey = [`/api/cookbooks/${cookbookId}/photos`];
  const { data: family = [] } = useQuery<{ id: string; width: number; height: number }[]>({ queryKey: photosKey });
  const { data: options } = useQuery<{ cards: { id: string; title: string }[] }>({ queryKey: [`/api/cookbooks/${cookbookId}/cover-options`] });
  const cards = options?.cards ?? [];
  const inBook = new Set(draft.layoutData.sections.flatMap((s) => s.recipeIds));
  const dishes = allRecipes.filter((r) => r.dishImageThumbnail && inBook.has(r.id));
  const q = query.trim().toLowerCase();
  const shownDishes = (q ? dishes.filter((r) => r.title.toLowerCase().includes(q)) : dishes).slice(0, 40);
  const shownCards = q ? cards.filter((c) => c.title.toLowerCase().includes(q)) : cards;

  const isOn = (kind: CoverPhoto["kind"], id: string) => selected?.kind === kind && selected.id === id;

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photos", await downscale(file), file.name.replace(/\.\w+$/, "") + ".jpg");
      const body = await (await apiRequest("POST", `/api/cookbooks/${cookbookId}/photos`, form)).json();
      const added = body.added?.[0] as { id: string; width: number; height: number } | undefined;
      if (!added) throw new Error("not added");
      queryClient.setQueryData(photosKey, (old: any[] | undefined) => [...(old ?? []), added]);
      // Kept with the book's photos, but not placed inside the book on its own
      const entry: FamilyPhotoEntry = { ...added, placement: { type: "unplaced", byUser: true, reason: "On the cover" } };
      updateLayout({
        familyPhotos: [...(draft.layoutData.familyPhotos ?? []), entry],
        coverData: { ...(draft.layoutData.coverData ?? {}), photo: { kind: "family", id: added.id } },
      });
    } catch {
      toast({ title: "Couldn't add that photo", description: "Try a JPG or PNG.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tile = (key: string, on: boolean, onClick: () => void, src: string | null, label: string, wide?: boolean) => (
    <li key={key} className="shrink-0">
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        title={label}
        onClick={onClick}
        className={cn(
          "relative block h-20 overflow-hidden rounded-md border bg-muted",
          wide ? "w-28" : "w-20",
          on ? "ring-2 ring-primary ring-offset-2" : "hover:opacity-90",
        )}
      >
        {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />}
        {on && (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </button>
    </li>
  );

  return (
    <section aria-labelledby="photo-heading" className="space-y-4">
      <div>
        <h3 id="photo-heading" className="text-lg font-semibold">Cover photo</h3>
        <p className="text-sm text-muted-foreground">A family photo, one of the original cards, or a favorite dish.</p>
      </div>

      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 py-2" role="list" aria-label="Family photos">
        <li className="shrink-0">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
            {uploading ? "Adding…" : "Add photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files)} />
        </li>
        <li className="shrink-0">
          <button
            type="button"
            aria-pressed={!selected}
            onClick={() => onSelect(null)}
            className={cn(
              "flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium text-muted-foreground",
              !selected ? "ring-2 ring-primary ring-offset-2" : "hover:bg-accent/50",
            )}
          >
            <ImageOff className="h-5 w-5" aria-hidden /> No photo
          </button>
        </li>
        {family.map((p) => tile(`f-${p.id}`, isOn("family", p.id), () => onSelect({ kind: "family", id: p.id }), privateImageUrl(`/api/cookbook-photos/${p.id}`, pass), "Family photo"))}
      </ul>

      {(cards.length > 0 || dishes.length > 0) && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a recipe's photo or card" className="pl-9" aria-label="Find a recipe's photo or card" />
        </div>
      )}

      {shownCards.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Handwritten cards</p>
          <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 py-2" role="list">
            {shownCards.slice(0, 40).map((c) =>
              tile(`c-${c.id}`, isOn("card", c.id), () => onSelect({ kind: "card", id: c.id }), privateImageUrl(`/api/cookbooks/${cookbookId}/original-cards/${c.id}`, pass), `${c.title} (card)`, true),
            )}
          </ul>
        </div>
      )}

      {shownDishes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Dish photos</p>
          <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 py-2" role="list">
            {shownDishes.map((r) => tile(`r-${r.id}`, isOn("recipe", r.id), () => onSelect({ kind: "recipe", id: r.id }), mediaUrl(r.dishImageThumbnail) ?? null, r.title))}
          </ul>
        </div>
      )}
    </section>
  );
}
