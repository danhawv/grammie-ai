import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Camera, FileText, Globe, ImageIcon, Link2, Loader2, RotateCcw, RotateCw, Trash2, X } from "lucide-react";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoPicker } from "@/components/photo-picker";
import { CookbookSelect } from "@/components/cookbook-select";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUploadProgress } from "@/contexts/UploadProgressContext";
import { usePreferences } from "@/hooks/use-preferences";
import { wantsImportCheck } from "@shared/food-profile";
import { downscaleImage, makeThumbnail, rotateImage } from "@/lib/images";
import {
  addToCookbook,
  apiErrorMessage,
  detectLinkPlatform,
  importLink,
  importText,
  uploadRecipePhotos,
} from "@/lib/import-api";
import { cn } from "@/lib/utils";

// The one "Add recipe" sheet (docs/DESIGN_PRINCIPLES.md §3, §4, §6): three
// large choices — Photo, Link or post, Type or paste. Batch import is the
// "Add several recipes" link inside Photo. Every import ends on the review
// screen (one recipe) or the progress list (several), never saved unseen.
// Dialog on desktop, bottom sheet on phones.

type View = "choose" | "photo" | "link" | "text";
type InitialMode = "image" | "link" | "text";

const MAX_PAGES = 5;
const MAX_BATCH = 10;
const MIN_TEXT = 20;

interface PickedPhoto {
  id: string;
  /** Shrunk copy (or the original when the browser can't decode it) */
  blob: Blob;
  preview: string | null;
  thumbnail: string | null;
  name: string;
  rotation: number;
}

interface UploadRecipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump straight to one choice; omit to show all three */
  initialMode?: InitialMode;
}

const viewFor = (mode?: InitialMode): View => (mode === "image" ? "photo" : mode ?? "choose");

export function UploadRecipeModal({ open, onOpenChange, initialMode }: UploadRecipeModalProps) {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { addRecipe, startPhotoBatch } = useUploadProgress();
  // Straight to the recipe, unless "Check each recipe" is on in Me → Adding recipes
  const { preferences } = usePreferences();
  const recipePageAfterImport = (id: string) => (wantsImportCheck(preferences) ? `/recipe/${id}/review` : `/recipe/${id}`);

  const [view, setView] = useState<View>(viewFor(initialMode));
  const [batch, setBatch] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [cookbookId, setCookbookId] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const { data: authStatus } = useQuery<{ isAuthenticated: boolean }>({
    queryKey: ["/api/auth/status"],
    enabled: open,
  });
  const needsSignIn = open && authStatus && !authStatus.isAuthenticated;

  useEffect(() => {
    if (open) setView(viewFor(initialMode));
  }, [open, initialMode]);

  const reset = () => {
    photosRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setView("choose");
    setBatch(false);
    setPhotos([]);
    setLink("");
    setText("");
    setCookbookId(undefined);
    setBusy(null);
    setError(null);
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 300);
  };

  const handleOpenChange = (next: boolean) => {
    // Closing mid-upload is fine for batches (they run in the background),
    // but a single upload is waiting on the server: keep the sheet up
    if (!next && !busy) close();
  };

  const goTo = (next: View) => {
    setError(null);
    setView(next);
  };

  // ---- Photo ---------------------------------------------------------------

  const limit = batch ? MAX_BATCH : MAX_PAGES;

  const addPhotos = async (files: File[]) => {
    setError(null);
    const room = limit - photos.length;
    if (room <= 0) {
      setError(batch ? `You can add up to ${MAX_BATCH} recipes at a time.` : `A recipe can have up to ${MAX_PAGES} photos.`);
      return;
    }
    if (files.length > room) {
      setError(
        batch
          ? `Only the first ${room} were added. You can add up to ${MAX_BATCH} recipes at a time.`
          : `Only the first ${room} were added. A recipe can have up to ${MAX_PAGES} photos.`,
      );
    }
    const chosen = files.slice(0, room);
    setPreparing((n) => n + chosen.length);
    for (const file of chosen) {
      const blob = await downscaleImage(file);
      const decodable = blob !== file || /^image\/(jpeg|png|webp|gif)$/.test(file.type);
      const photo: PickedPhoto = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        blob,
        preview: decodable ? URL.createObjectURL(blob) : null,
        thumbnail: decodable ? await makeThumbnail(blob) : null,
        name: file.name,
        rotation: 0,
      };
      setPhotos((prev) => [...prev, photo]);
      setPreparing((n) => n - 1);
    }
  };

  const rotate = (id: string, by: number) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + by + 360) % 360 } : p)));

  const remove = (id: string) =>
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((p) => p.id !== id);
    });

  const switchBatch = (next: boolean) => {
    setBatch(next);
    setError(null);
    if (!next && photos.length > MAX_PAGES) {
      photos.slice(MAX_PAGES).forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      setPhotos(photos.slice(0, MAX_PAGES));
    }
  };

  const finalBlobs = () => Promise.all(photos.map((p) => rotateImage(p.blob, p.rotation)));

  const submitPhotos = async () => {
    if (photos.length === 0) return;
    setError(null);
    if (batch) {
      const blobs = await finalBlobs();
      startPhotoBatch(blobs.map((blob, i) => ({ blob, thumbnail: photos[i].thumbnail })), { cookbookId });
      close();
      navigate("/processing");
      return;
    }
    setBusy(photos.length === 1 ? "Sending your photo…" : `Sending ${photos.length} photos…`);
    try {
      const recipeId = await uploadRecipePhotos(await finalBlobs());
      addRecipe(recipeId, "Your Recipe", { kind: "photo", thumbnail: photos[0].thumbnail });
      await addToCookbook(cookbookId, recipeId);
      done(recipePageAfterImport(recipeId));
    } catch (err) {
      setBusy(null);
      setError(apiErrorMessage(err, "The photo didn't upload. Check your connection and try again."));
    }
  };

  // ---- Link and text ---------------------------------------------------------

  const platform = detectLinkPlatform(link);

  const submitLink = async () => {
    setError(null);
    if (!platform) {
      setError("That doesn't look like a web address. Copy the whole link and paste it again.");
      return;
    }
    setBusy(platform === "web" ? "Reading the page…" : "Reading the post…");
    try {
      const { recipeId } = await importLink(link);
      addRecipe(recipeId, "Your Recipe", { kind: platform === "web" ? "link" : "social" });
      await addToCookbook(cookbookId, recipeId);
      done(recipePageAfterImport(recipeId));
    } catch (err) {
      setBusy(null);
      setError(apiErrorMessage(err, "Grammie couldn't read that link. Check it opens in your browser, or paste the recipe text instead."));
    }
  };

  const submitText = async () => {
    setError(null);
    if (text.trim().length < MIN_TEXT) {
      setError("Paste the whole recipe, with the ingredients and the steps.");
      return;
    }
    setBusy("Reading your recipe…");
    try {
      const recipeId = await importText(text);
      addRecipe(recipeId, "Your Recipe", { kind: "text" });
      await addToCookbook(cookbookId, recipeId);
      done(recipePageAfterImport(recipeId));
    } catch (err) {
      setBusy(null);
      setError(apiErrorMessage(err, "Grammie couldn't find a recipe in that text. Include a title, ingredients and steps."));
    }
  };

  const done = (href: string) => {
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/recipes" });
    setBusy(null);
    close();
    navigate(href);
  };

  // ---- Layout ----------------------------------------------------------------

  const title = needsSignIn
    ? "Sign in to add recipes"
    : view === "choose"
      ? "Add a recipe"
      : view === "photo"
        ? batch ? "Add several recipes" : "Photo of a recipe"
        : view === "link"
          ? "Link or post"
          : "Type or paste";

  const description = needsSignIn
    ? "Your recipes are saved to your account, so you'll need to sign in first."
    : view === "choose"
      ? "Grammie reads handwriting, cookbook pages and recipe posts. You'll check everything before it's saved."
      : view === "photo"
        ? batch
          ? `Each photo becomes its own recipe (up to ${MAX_BATCH}). You'll check each one after Grammie reads it.`
          : `Add up to ${MAX_PAGES} photos of the same recipe, like the front and back of a card. They're read as one recipe.`
        : view === "link"
          ? "Paste a link to a recipe website, or an Instagram, TikTok or YouTube post."
          : "Type the recipe or paste it from somewhere else. Grammie sorts it into ingredients and steps.";

  const body = needsSignIn ? (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button className="h-12 flex-1" onClick={() => { close(); navigate("/login"); }} data-testid="button-sign-in">
        Sign in
      </Button>
    </div>
  ) : view === "choose" ? (
    <div className="grid gap-3">
      <ChoiceButton icon={<Camera className="h-7 w-7" aria-hidden />} title="Photo" detail="Take a photo of a recipe card or cookbook page, or choose one" onClick={() => goTo("photo")} testId="choice-photo" />
      <ChoiceButton icon={<Link2 className="h-7 w-7" aria-hidden />} title="Link or post" detail="A recipe website, Instagram, TikTok or YouTube" onClick={() => goTo("link")} testId="choice-link" />
      <ChoiceButton icon={<FileText className="h-7 w-7" aria-hidden />} title="Type or paste" detail="Write it in, or paste it from an email or note" onClick={() => goTo("text")} testId="choice-text" />
    </div>
  ) : view === "photo" ? (
    <div className="space-y-4">
      {photos.length < limit && (
        <PhotoPicker onPick={addPhotos} multiple disabled={!!busy} libraryLabel={photos.length ? "Add more photos" : "Choose photos"} variant={photos.length ? "buttons" : "zone"}>
          <ImageIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-base">{batch ? "Add photos of your recipes" : "Add photos of your recipe"}</p>
          <p className="text-sm text-muted-foreground">Flat, in good light, with the whole card in view</p>
        </PhotoPicker>
      )}

      {(photos.length > 0 || preparing > 0) && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={batch ? "Recipes to add" : "Pages of this recipe"}>
          {photos.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-lg border bg-card">
              <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                {p.preview ? (
                  <img
                    src={p.preview}
                    alt={batch ? `Recipe ${i + 1}` : `Page ${i + 1}`}
                    className="h-full w-full object-contain transition-transform motion-reduce:transition-none"
                    style={{ transform: `rotate(${p.rotation}deg)` }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 p-2 text-center text-sm text-muted-foreground">
                    <ImageIcon className="h-6 w-6" aria-hidden />
                    <span className="line-clamp-2 break-all">{p.name}</span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-sm font-medium">
                  {batch ? `Recipe ${i + 1}` : `Page ${i + 1}`}
                </span>
              </div>
              <div className="flex justify-between gap-1 p-1">
                <Button type="button" variant="ghost" size="icon" onClick={() => rotate(p.id, -90)} disabled={!p.preview || !!busy} aria-label={`Turn ${batch ? "recipe" : "page"} ${i + 1} left`} title="Turn left">
                  <RotateCcw aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => rotate(p.id, 90)} disabled={!p.preview || !!busy} aria-label={`Turn ${batch ? "recipe" : "page"} ${i + 1} right`} title="Turn right">
                  <RotateCw aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(p.id)} disabled={!!busy} aria-label={`Remove ${batch ? "recipe" : "page"} ${i + 1}`} title="Remove">
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
          {Array.from({ length: preparing }).map((_, i) => (
            <li key={`prep-${i}`} className="flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted" role="status" aria-label="Preparing photo">
              <Loader2 className="h-6 w-6 text-muted-foreground motion-safe:animate-spin" aria-hidden />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="inline-flex min-h-11 items-center text-base font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
        onClick={() => switchBatch(!batch)}
        disabled={!!busy}
        data-testid="button-toggle-batch"
      >
        {batch ? "Back to one recipe with several pages" : "Add several recipes at once"}
      </button>
    </div>
  ) : view === "link" ? (
    <form id="add-recipe-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submitLink(); }}>
      <div className="space-y-2">
        <Label htmlFor="add-recipe-link" className="text-base">Link</Label>
        <Input
          id="add-recipe-link"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://"
          value={link}
          onChange={(e) => { setLink(e.target.value); setError(null); }}
          disabled={!!busy}
          aria-invalid={!!error}
          aria-describedby={error ? "add-recipe-error" : "add-recipe-link-hint"}
          className="h-12 text-base"
          data-testid="input-link-url"
          autoFocus={!isMobile}
        />
        <p id="add-recipe-link-hint" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Globe className="h-4 w-4" aria-hidden /> Recipe websites</span>
          <span className="inline-flex items-center gap-1.5"><SiInstagram className="h-4 w-4" aria-hidden /> Instagram</span>
          <span className="inline-flex items-center gap-1.5"><SiTiktok className="h-4 w-4" aria-hidden /> TikTok</span>
        </p>
      </div>
    </form>
  ) : (
    <form id="add-recipe-form" className="space-y-2" onSubmit={(e) => { e.preventDefault(); void submitText(); }}>
      <Label htmlFor="add-recipe-text" className="text-base">Recipe</Label>
      <Textarea
        id="add-recipe-text"
        placeholder={"Grandma's Sugar Cookies\n\n2 cups flour\n1 cup butter, softened\n…\n\n1. Heat the oven to 350°F.\n2. …"}
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        disabled={!!busy}
        aria-invalid={!!error}
        aria-describedby={error ? "add-recipe-error" : undefined}
        className="min-h-[14rem] text-base"
        data-testid="input-recipe-text"
      />
    </form>
  );

  const primary = needsSignIn || view === "choose" ? null : view === "photo" ? (
    <Button
      className="h-12 w-full text-base"
      onClick={() => void submitPhotos()}
      disabled={photos.length === 0 || preparing > 0 || !!busy}
      data-testid="button-extract-recipe"
    >
      {busy ? <><Loader2 className="motion-safe:animate-spin" aria-hidden /> {busy}</> :
        batch ? (photos.length ? `Read ${photos.length} ${photos.length === 1 ? "recipe" : "recipes"}` : "Read recipes") :
        photos.length > 1 ? `Read ${photos.length} pages as one recipe` : "Read this recipe"}
    </Button>
  ) : (
    <Button
      type="submit"
      form="add-recipe-form"
      className="h-12 w-full text-base"
      disabled={!!busy || (view === "link" ? !link.trim() : !text.trim())}
      data-testid={view === "link" ? "button-import-link" : "button-extract-text"}
    >
      {busy ? <><Loader2 className="motion-safe:animate-spin" aria-hidden /> {busy}</> : view === "link" ? "Read this link" : "Read this recipe"}
    </Button>
  );

  const content = (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2">
        {view !== "choose" && !needsSignIn && (
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => goTo("choose")} disabled={!!busy} aria-label="Back to all choices" title="Back">
            <ArrowLeft aria-hidden />
          </Button>
        )}
        <div className="min-w-0 flex-1 pt-1.5">
          {isMobile ? (
            <>
              <SheetTitle className="font-serif text-2xl">{title}</SheetTitle>
              <SheetDescription className="mt-1 text-base text-muted-foreground">{description}</SheetDescription>
            </>
          ) : (
            <>
              <DialogTitle className="font-serif text-2xl">{title}</DialogTitle>
              <DialogDescription className="mt-1 text-base text-muted-foreground">{description}</DialogDescription>
            </>
          )}
        </div>
        {isMobile ? (
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="-mr-2 shrink-0" aria-label="Close" disabled={!!busy}><X aria-hidden /></Button>
          </SheetClose>
        ) : (
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="-mr-2 shrink-0" aria-label="Close" disabled={!!busy}><X aria-hidden /></Button>
          </DialogClose>
        )}
      </div>

      {body}

      {!needsSignIn && view !== "choose" && (
        <div className="space-y-2">
          <Label className="text-base">Add to a cookbook <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <CookbookSelect value={cookbookId} onValueChange={setCookbookId} />
        </div>
      )}

      {error && (
        <p id="add-recipe-error" role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-base text-destructive">
          {error}
        </p>
      )}

      {primary}
    </div>
  );

  // The built-in close button is small; ours above is 44 px, so hide theirs
  const hideBuiltInClose = "[&>button:last-child]:hidden";

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          className={cn("max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4", hideBuiltInClose)}
          data-testid="modal-upload-recipe"
        >
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto sm:max-w-xl", hideBuiltInClose)} data-testid="modal-upload-recipe">
        {content}
      </DialogContent>
    </Dialog>
  );
}

function ChoiceButton({ icon, title, detail, onClick, testId }: { icon: ReactNode; title: string; detail: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[4.5rem] w-full items-center gap-4 rounded-xl border-2 bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold">{title}</span>
        <span className="block text-base text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
