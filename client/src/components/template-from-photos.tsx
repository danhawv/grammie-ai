import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, ImagePlus, Loader2, Wand2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CustomTemplate } from "@shared/schema";

// "Create from cookbook photos": take or upload 1-5 photos of a cookbook page
// or recipe card, and the AI builds a custom template matching its colors,
// fonts and page layout.

const MAX_PHOTOS = 5;

/** Shrink big phone photos before upload; falls back to the original file */
async function downscale(file: File, maxSide = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function TemplateFromPhotos({ onCreated }: { onCreated: (t: CustomTemplate) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...next].slice(0, MAX_PHOTOS));
  };

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
  };

  const create = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      for (let i = 0; i < photos.length; i++) {
        form.append("images", await downscale(photos[i].file), `page-${i + 1}.jpg`);
      }
      const res = await apiRequest("POST", "/api/templates/from-photos", form);
      return res.json() as Promise<CustomTemplate>;
    },
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: `Created "${template.name}"`, description: "It's selected now. Open the preview to see it, or edit it like any template." });
      onCreated(template);
      reset();
      setOpen(false);
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^\d+:\s*/, "");
      let description = msg;
      try { description = JSON.parse(msg).error ?? msg; } catch { /* plain text */ }
      toast({ title: "Couldn't create the template", description, variant: "destructive" });
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => setOpen(true)}
        data-testid="template-from-photos"
      >
        <Camera className="w-3.5 h-3.5" />
        Create from cookbook photos
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!create.isPending) { setOpen(v); if (!v) reset(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Match a cookbook's style</DialogTitle>
            <DialogDescription>
              Take or upload up to {MAX_PHOTOS} photos of recipe pages you love. The AI matches their colors, fonts and
              page layout, then saves the result as a template you can edit.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative aspect-[3/4] rounded-md overflow-hidden border bg-muted">
                <img src={p.url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white"
                  onClick={() => {
                    URL.revokeObjectURL(p.url);
                    setPhotos((prev) => prev.filter((x) => x !== p));
                  }}
                  aria-label={`Remove photo ${i + 1}`}
                  disabled={create.isPending}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <>
                <button
                  className="aspect-[3/4] rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-accent sm:hidden"
                  onClick={() => cameraRef.current?.click()}
                  disabled={create.isPending}
                >
                  <Camera className="w-5 h-5" />
                  Take photo
                </button>
                <button
                  className="aspect-[3/4] rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-accent"
                  onClick={() => uploadRef.current?.click()}
                  disabled={create.isPending}
                >
                  <ImagePlus className="w-5 h-5" />
                  Add photos
                </button>
              </>
            )}
          </div>
          <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

          <p className="text-xs text-muted-foreground">
            Tip: shoot the page flat and straight-on in good light. Only the style is matched; text, logos and photos
            from the book are never copied.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={create.isPending}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={photos.length === 0 || create.isPending} className="gap-1.5">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {create.isPending ? "Matching style…" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
