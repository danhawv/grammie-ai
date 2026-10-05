import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, BookImage, ImagePlus, Loader2, MoreVertical, Wand2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FamilyPhotoEntry, PrintLayoutData } from "@shared/schema";

// Family photos: upload a batch, then "Place photos" puts each one in the
// empty space under a recipe (never moving the recipe). Photos that don't
// fit are flagged with options to add them to the Family Album or swap them
// with a placed photo.

const BATCH = 6;

async function downscale(file: File, maxSide = 2400): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

interface Props {
  cookbookId: number;
  layoutData: PrintLayoutData;
  onChange: (photos: FamilyPhotoEntry[]) => void;
  templateStyle: string;
  customTemplateId: number | null;
  recipeTitles: Map<string, string>;
}

export function FamilyPhotosPanel({ cookbookId, layoutData, onChange, templateStyle, customTemplateId, recipeTitles }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const photos = layoutData.familyPhotos ?? [];

  // Photos uploaded but never saved into the layout (e.g. left without saving)
  // still belong to the book; show them as not placed yet
  const storedKey = [`/api/cookbooks/${cookbookId}/photos`];
  const { data: stored } = useQuery<{ id: string; width: number; height: number }[]>({ queryKey: storedKey });
  useEffect(() => {
    if (!stored) return;
    const known = new Set(photos.map((p) => p.id));
    const missing = stored.filter((p) => !known.has(p.id));
    if (missing.length) onChange([...photos, ...missing]);
    // Re-run when the saved layout loads, too, so it can't drop these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, layoutData.familyPhotos]);

  const inBook = useMemo(() => new Set(layoutData.sections.flatMap((s) => s.recipeIds)), [layoutData.sections]);
  const placed = photos.filter((p) => p.placement?.type === "recipe" && p.placement.recipeId && inBook.has(p.placement.recipeId));
  const album = photos.filter((p) => p.placement?.type === "album");
  const unplaced = photos.filter((p) => p.placement?.type === "unplaced");
  const notYet = photos.filter((p) => !p.placement);

  const update = (id: string, change: Partial<FamilyPhotoEntry>) =>
    onChange(photos.map((p) => (p.id === id ? { ...p, ...change } : p)));

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setUploading({ done: 0, total: list.length });
    const added: FamilyPhotoEntry[] = [];
    const failed: string[] = [];
    for (let i = 0; i < list.length; i += BATCH) {
      const form = new FormData();
      for (const f of list.slice(i, i + BATCH)) form.append("photos", await downscale(f), f.name.replace(/\.\w+$/, "") + ".jpg");
      try {
        const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/photos`, form);
        const body = await res.json();
        added.push(...body.added);
        failed.push(...body.failed);
      } catch {
        failed.push(...list.slice(i, i + BATCH).map((f) => f.name));
      }
      setUploading({ done: Math.min(list.length, i + BATCH), total: list.length });
    }
    setUploading(null);
    if (added.length) {
      queryClient.setQueryData(storedKey, (old: any[] | undefined) => [...(old ?? []), ...added]);
      onChange([...photos, ...added]);
    }
    toast({
      title: `Added ${added.length} photo${added.length === 1 ? "" : "s"}`,
      description: failed.length
        ? `${failed.length} couldn't be read (try JPG or PNG).`
        : "Click Place photos to put them in the book.",
      variant: failed.length && !added.length ? "destructive" : undefined,
    });
  };

  const place = useMutation({
    mutationFn: async (current: FamilyPhotoEntry[]) => {
      const res = await apiRequest("POST", `/api/cookbooks/${cookbookId}/photos/place`, {
        layoutData: { ...layoutData, familyPhotos: current },
        templateStyle,
        customTemplateId,
      });
      return res.json() as Promise<{ familyPhotos: FamilyPhotoEntry[]; placed: number; unplaced: number }>;
    },
    onSuccess: (r) => {
      onChange(r.familyPhotos);
      toast({
        title: `Placed ${r.placed} photo${r.placed === 1 ? "" : "s"}`,
        description: r.unplaced ? `${r.unplaced} didn't fit anywhere. See below to add them to the album or swap them in.` : "Open the preview to see them.",
      });
    },
    onError: () => toast({ title: "Couldn't place photos", description: "Try again in a moment.", variant: "destructive" }),
  });

  const removePhoto = async (p: FamilyPhotoEntry) => {
    try {
      await apiRequest("DELETE", `/api/cookbook-photos/${p.id}`);
    } catch {
      // Already gone on the server; still drop it from the book
    }
    queryClient.setQueryData(storedKey, (old: any[] | undefined) => (old ?? []).filter((x) => x.id !== p.id));
    onChange(photos.filter((x) => x.id !== p.id));
  };

  // The unplaced photo takes the placed photo's spot; the placed one becomes unplaced
  const swap = (from: FamilyPhotoEntry, into: FamilyPhotoEntry) => {
    onChange(photos.map((p) => {
      if (p.id === from.id) return { ...p, placement: into.placement, pinnedRecipeId: into.placement?.recipeId };
      if (p.id === into.id) return { ...p, pinnedRecipeId: undefined, placement: { type: "unplaced" as const, reason: "Swapped out" } };
      return p;
    }));
  };

  const status = (p: FamilyPhotoEntry) => {
    if (p.placement?.type === "recipe" && p.placement.recipeId)
      return { text: recipeTitles.get(p.placement.recipeId) ?? "Recipe", tone: "text-foreground" };
    if (p.placement?.type === "album") return { text: "Family Album", tone: "text-foreground" };
    if (p.placement?.type === "unplaced") return { text: "Doesn't fit", tone: "text-destructive" };
    return { text: "Not placed yet", tone: "text-muted-foreground" };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><BookImage className="w-4 h-4" /> Family Photos</CardTitle>
        <CardDescription>
          Add photos of family and good times. They go in the empty space under recipes, so recipes never move.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => fileRef.current?.click()} disabled={!!uploading}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            {uploading ? `Uploading ${uploading.done}/${uploading.total}` : "Add photos"}
          </Button>
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => place.mutate(photos)}
            disabled={photos.length === 0 || place.isPending || !!uploading}
            data-testid="place-family-photos"
          >
            {place.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {place.isPending ? "Placing…" : "Place photos"}
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />

        {photos.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {placed.length} under recipes · {album.length} in album
            {unplaced.length ? ` · ${unplaced.length} don't fit` : ""}
            {notYet.length ? ` · ${notYet.length} not placed yet` : ""}
          </p>
        )}

        {unplaced.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-px" />
              <span>
                {unplaced.length} photo{unplaced.length === 1 ? " doesn't" : "s don't"} fit under any recipe. Add {unplaced.length === 1 ? "it" : "them"} to
                the Family Album at the end of the book, or use a photo's menu to swap it with one that's placed.
              </span>
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => onChange(photos.map((p) => (p.placement?.type === "unplaced" ? { ...p, pinnedRecipeId: undefined, placement: { type: "album" as const } } : p)))}
            >
              Add {unplaced.length === 1 ? "it" : `all ${unplaced.length}`} to the album
            </Button>
          </div>
        )}

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
            {photos.map((p) => {
              const s = status(p);
              return (
                <div key={p.id} className="space-y-1">
                  <div className={`relative aspect-square rounded-md overflow-hidden border bg-muted ${p.placement?.type === "unplaced" ? "ring-2 ring-destructive/60" : ""}`}>
                    <img src={`/api/cookbook-photos/${p.id}`} alt="" className="w-full h-full object-cover" loading="lazy" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="absolute top-0 right-0 flex h-11 w-11 items-start justify-end p-1" aria-label="Photo options">
                          <span className="rounded-full bg-black/60 p-1 text-white"><MoreVertical className="w-4 h-4" /></span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">{s.text}</DropdownMenuLabel>
                        {p.placement?.type === "unplaced" && p.placement.reason && (
                          <DropdownMenuLabel className="text-xs font-normal pt-0">{p.placement.reason}</DropdownMenuLabel>
                        )}
                        <DropdownMenuSeparator />
                        {p.placement?.type !== "album" ? (
                          <DropdownMenuItem onClick={() => update(p.id, { pinnedRecipeId: undefined, placement: { type: "album" } })}>
                            Move to Family Album
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => update(p.id, { placement: undefined })}>
                            Take out of album
                          </DropdownMenuItem>
                        )}
                        {p.placement?.type !== "recipe" && placed.length > 0 && (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Swap with a placed photo</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-56">
                              {placed.map((q) => (
                                <DropdownMenuItem key={q.id} onClick={() => swap(p, q)} className="gap-2">
                                  <img src={`/api/cookbook-photos/${q.id}`} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                                  <span className="truncate text-xs">{recipeTitles.get(q.placement!.recipeId!) ?? "Recipe"}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Put on a specific recipe</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-60">
                            {layoutData.sections.flatMap((sec) => sec.recipeIds).map((rid) => (
                              <DropdownMenuItem
                                key={rid}
                                className="text-xs"
                                onClick={() => {
                                  const next = photos.map((x) => (x.id === p.id ? { ...x, pinnedRecipeId: rid, placement: undefined } : x));
                                  onChange(next);
                                  place.mutate(next);
                                }}
                              >
                                <span className="truncate">{recipeTitles.get(rid) ?? "Recipe"}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => removePhoto(p)}>
                          Remove photo
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className={`text-xs leading-tight truncate ${s.tone}`} title={s.text}>{s.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
