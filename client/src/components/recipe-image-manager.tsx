import { useState, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CreditNote } from "@/components/credits";
import { refreshCredits } from "@/lib/credits-api";
import { apiErrorMessage } from "@/lib/import-api";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ChevronLeft, ChevronRight, Upload, Trash2, Wand2, Sparkles, Image as ImageIcon, GripVertical, X, Check, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch, mediaUrl } from "@/lib/platform";

interface DishImage {
  id: string;
  url: string;
  thumbnailUrl?: string;
  isAiGenerated: boolean;
  order: number;
  createdAt: string;
}

interface RecipeImageManagerProps {
  recipeId: string;
  dishImages: DishImage[];
  currentImage: string | null;
  isOwner: boolean;
  recipeName: string;
  onImagesChange?: (images: DishImage[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

/** A carousel picture: a dish photo or the handwritten card */
export interface CarouselImage {
  id: string;
  url: string;
  isAiGenerated: boolean;
}

/**
 * A thin white chevron with a soft shadow and no background, on a 44px tap
 * target. Shared by the recipe hero carousel and the full-screen viewer.
 */
export function CarouselArrow({
  direction,
  onClick,
  className,
  label,
  testId,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  className?: string;
  label: string;
  testId?: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-11 w-11 items-center justify-center rounded-full text-white [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.6))] focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${className ?? ""}`}
      data-testid={testId}
    >
      <Icon className="h-7 w-7" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/**
 * Pointer handlers that call back on a sideways swipe (touch, pen or mouse)
 * while leaving vertical scrolling alone.
 */
export function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onNext(); else onPrev();
    },
    onPointerCancel: () => { start.current = null; },
  };
}

/**
 * The hero's picture strip: one image at a time, thin arrows at the sides
 * and swipe to move. Controlled through `index` when the parent needs to
 * know which picture is up (the recipe hero hides its card snapshot while
 * the card itself is showing).
 */
export function RecipeImageCarousel({
  images,
  index: controlledIndex,
  onIndexChange,
  arrowsRaised = false,
}: {
  images: CarouselImage[];
  index?: number;
  onIndexChange?: (index: number) => void;
  /** Lift the arrows above the hero's midline (room for the card snapshot) */
  arrowsRaised?: boolean;
}) {
  const [internalIndex, setInternalIndex] = useState(0);
  const currentIndex = Math.min(controlledIndex ?? internalIndex, Math.max(images.length - 1, 0));

  const goTo = (i: number) => {
    setInternalIndex(i);
    onIndexChange?.(i);
  };
  const goToPrevious = () => goTo(currentIndex === 0 ? images.length - 1 : currentIndex - 1);
  const goToNext = () => goTo(currentIndex === images.length - 1 ? 0 : currentIndex + 1);
  const swipe = useSwipe(goToPrevious, goToNext);

  if (images.length === 0) return null;
  const currentDisplayImage = images[currentIndex];
  const arrowTop = arrowsRaised ? "top-[38%]" : "top-1/2";

  return (
    <div
      className="relative h-full w-full select-none [touch-action:pan-y]"
      {...(images.length > 1 ? swipe : {})}
      data-testid="recipe-carousel"
    >
      <img
        src={mediaUrl(currentDisplayImage?.url)}
        alt={currentDisplayImage?.isAiGenerated ? "Recipe dish" : "Original recipe card"}
        className="h-full w-full object-cover"
        draggable={false}
        data-testid="img-recipe-carousel"
      />

      {images.length > 1 && (
        <>
          <CarouselArrow
            direction="prev"
            label="Previous picture"
            onClick={goToPrevious}
            className={`absolute left-1 ${arrowTop} z-30 -translate-y-1/2`}
            testId="button-carousel-prev"
          />
          <CarouselArrow
            direction="next"
            label="Next picture"
            onClick={goToNext}
            className={`absolute right-1 ${arrowTop} z-30 -translate-y-1/2`}
            testId="button-carousel-next"
          />
        </>
      )}

      {currentDisplayImage?.isAiGenerated && (
        <Badge
          variant="secondary"
          className="absolute top-4 left-4 z-20 bg-background/80 backdrop-blur-sm gap-1"
          data-testid="badge-ai-generated"
        >
          <Sparkles className="h-3 w-3" />
          AI Generated
        </Badge>
      )}
    </div>
  );
}

export function RecipeImageManager({
  recipeId,
  dishImages,
  currentImage,
  isOwner,
  recipeName,
  onImagesChange,
  open,
  onOpenChange,
  hideTrigger = false,
}: RecipeImageManagerProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  
  // Support both controlled and uncontrolled modes
  const isDialogOpen = open !== undefined ? open : internalOpen;
  const setIsDialogOpen = (value: boolean) => {
    if (onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalOpen(value);
    }
  };
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const images = (dishImages || []).sort((a, b) => a.order - b.order);
  const canAddMore = images.length < 5;

  const { data: promptData, isLoading: isLoadingPrompt } = useQuery({
    queryKey: ['/api/recipes', recipeId, 'image-prompt'],
    queryFn: () => apiFetch(`/api/recipes/${recipeId}/image-prompt`, { credentials: 'include' }).then(r => r.json()),
    enabled: isPromptDialogOpen,
  });

  const regenerateMutation = useMutation({
    mutationFn: async ({ prompt, replaceExisting }: { prompt: string; replaceExisting: boolean }) => {
      const res = await apiRequest('POST', `/api/recipes/${recipeId}/regenerate-image-custom`, {
        prompt,
        replaceExisting,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Image generated successfully" });
      refreshCredits();
      queryClient.invalidateQueries({ queryKey: ['/api/recipes', recipeId] });
      onImagesChange?.(data.dishImages);
      setIsPromptDialogOpen(false);
    },
    onError: (error: any) => {
      refreshCredits();
      toast({ title: "Failed to generate image", description: apiErrorMessage(error, "Please try again in a minute."), variant: "destructive" });
    },
  });

  // A new photo from the whole recipe (ingredients and finishing steps)
  const remakeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/recipes/${recipeId}/remake-photo`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "New photo made from the full recipe" });
      refreshCredits();
      queryClient.invalidateQueries({ queryKey: ['/api/recipes', recipeId] });
      onImagesChange?.(data.dishImages);
    },
    onError: (error: any) => {
      refreshCredits();
      toast({ title: "The photo couldn't be made", description: apiErrorMessage(error, "Please try again in a minute."), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const res = await apiRequest('DELETE', `/api/recipes/${recipeId}/images/${imageId}`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Image deleted" });
      queryClient.invalidateQueries({ queryKey: ['/api/recipes', recipeId] });
      onImagesChange?.(data.dishImages);
      setDeleteConfirmId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete image", description: error.message, variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (imageIds: string[]) => {
      const res = await apiRequest('POST', `/api/recipes/${recipeId}/reorder-images`, { imageIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/recipes', recipeId] });
      onImagesChange?.(data.dishImages);
    },
    onError: (error: any) => {
      toast({ title: "Failed to reorder images", description: error.message, variant: "destructive" });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canAddMore) {
      toast({ title: "Maximum 5 images allowed", description: "Delete an existing image first.", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    setIsUploading(true);
    try {
      const res = await apiFetch(`/api/recipes/${recipeId}/upload-image`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await res.json();
      toast({ title: "Image uploaded successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/recipes', recipeId] });
      onImagesChange?.(data.dishImages);
    } catch (error: any) {
      toast({ title: "Failed to upload image", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const moveImage = (imageId: string, direction: 'up' | 'down') => {
    const currentIndex = images.findIndex(img => img.id === imageId);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= images.length) return;

    const newOrder = [...images];
    [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
    reorderMutation.mutate(newOrder.map(img => img.id));
  };

  const handleOpenPromptDialog = () => {
    setEditedPrompt(promptData?.prompt || "");
    setIsPromptDialogOpen(true);
  };

  const applyQuickEdit = (modification: string) => {
    const currentPrompt = editedPrompt || promptData?.prompt || "";
    
    switch (modification) {
      case 'brighter':
        setEditedPrompt(currentPrompt.replace(/lighting:[^.]*\.?/i, '') + ' Lighting: bright, airy lighting with natural sunlight.');
        break;
      case 'rustic':
        setEditedPrompt(currentPrompt + ' Style: rustic farmhouse presentation on weathered wooden surface.');
        break;
      case 'modern':
        setEditedPrompt(currentPrompt + ' Style: modern minimalist plating on white ceramic plates.');
        break;
      case 'overhead':
        setEditedPrompt(currentPrompt.replace(/from [^,.]*(angle|shot)[^.]*\.?/gi, '') + ' Composition: overhead flat-lay shot looking straight down.');
        break;
      case 'closeup':
        setEditedPrompt(currentPrompt + ' Composition: extreme close-up macro shot highlighting texture.');
        break;
      default:
        break;
    }
  };

  if (!isOwner) return null;

  return (
    <>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {!hideTrigger && (
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/80 backdrop-blur-sm gap-2"
              data-testid="button-manage-images"
            >
              <ImageIcon className="h-4 w-4" />
              Manage Images
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="sm:max-w-2xl max-w-[95vw] overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Manage Recipe Images</DialogTitle>
            <DialogDescription className="text-sm">
              Upload your own photo, or have Grammie remake the photo from the full recipe (ingredients and steps). Earlier photos are kept here, up to 5.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={handleFileUpload}
                  className="hidden"
                  data-testid="input-upload-image"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canAddMore || isUploading}
                  className="gap-2"
                  data-testid="button-upload-image"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Upload Photo
                </Button>
                
                <Button
                  size="sm"
                  onClick={() => remakeMutation.mutate()}
                  disabled={remakeMutation.isPending}
                  className="gap-2"
                  data-testid="button-remake-from-recipe"
                >
                  {remakeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {remakeMutation.isPending ? "Making…" : <>Remake from recipe<CreditNote action="dish_photo" /></>}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenPromptDialog}
                  className="gap-2"
                  data-testid="button-generate-ai-image"
                >
                  <Sparkles className="h-4 w-4" />
                  Describe it yourself
                </Button>
              </div>
              
              <Badge variant="secondary" className="self-start sm:self-auto" data-testid="badge-image-slots">
                {images.length} / 5 images
              </Badge>
            </div>

            {images.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <ImageIcon className="h-12 w-12 mb-2 opacity-50" />
                <p>No images yet. Upload a photo or generate one with AI.</p>
              </div>
            )}

            <div className="space-y-2">
              {images.map((img, idx) => (
                <div
                  key={img.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                  data-testid={`image-item-${img.id}`}
                >
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveImage(img.id, 'up')}
                      disabled={idx === 0}
                      data-testid={`button-move-up-${img.id}`}
                    >
                      <ChevronLeft className="h-4 w-4 rotate-90" />
                    </Button>
                    <GripVertical className="h-4 w-4 text-muted-foreground mx-auto" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveImage(img.id, 'down')}
                      disabled={idx === images.length - 1}
                      data-testid={`button-move-down-${img.id}`}
                    >
                      <ChevronRight className="h-4 w-4 rotate-90" />
                    </Button>
                  </div>
                  
                  <img
                    src={mediaUrl(img.thumbnailUrl || img.url)}
                    alt={`Recipe image ${idx + 1}`}
                    className="w-20 h-20 object-cover rounded-md"
                    data-testid={`img-thumbnail-${img.id}`}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {idx === 0 && (
                        <Badge variant="default" className="text-xs" data-testid={`badge-primary-${img.id}`}>
                          Primary
                        </Badge>
                      )}
                      {img.isAiGenerated ? (
                        <Badge variant="secondary" className="text-xs gap-1" data-testid={`badge-ai-${img.id}`}>
                          <Sparkles className="h-3 w-3" />
                          AI
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs gap-1" data-testid={`badge-user-${img.id}`}>
                          <Upload className="h-3 w-3" />
                          Uploaded
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(img.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirmId(img.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    data-testid={`button-delete-${img.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} data-testid="button-close-manager">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPromptDialogOpen} onOpenChange={setIsPromptDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate AI Image</DialogTitle>
            <DialogDescription>
              Edit the prompt to customize how your dish looks. Use quick edits or write your own.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="prompt">Image Prompt</Label>
              {isLoadingPrompt ? (
                <div className="flex items-center gap-2 p-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading prompt...
                </div>
              ) : (
                <Textarea
                  id="prompt"
                  value={editedPrompt || promptData?.prompt || ""}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  rows={8}
                  className="mt-2 font-mono text-sm"
                  placeholder="Describe how you want the dish to look..."
                  data-testid="textarea-image-prompt"
                />
              )}
            </div>

            <div>
              <Label>Quick Edits</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickEdit('brighter')}
                  data-testid="button-quick-brighter"
                >
                  Brighter Lighting
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickEdit('rustic')}
                  data-testid="button-quick-rustic"
                >
                  Rustic Style
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickEdit('modern')}
                  data-testid="button-quick-modern"
                >
                  Modern Plating
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickEdit('overhead')}
                  data-testid="button-quick-overhead"
                >
                  Overhead Shot
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickEdit('closeup')}
                  data-testid="button-quick-closeup"
                >
                  Close-up Macro
                </Button>
              </div>
            </div>

            {images.length >= 5 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  You have 5 images. Generating a new one will replace the current primary image.
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsPromptDialogOpen(false)} data-testid="button-cancel-generate">
              Cancel
            </Button>
            <Button
              onClick={() => regenerateMutation.mutate({
                prompt: editedPrompt || promptData?.prompt || "",
                replaceExisting: images.length >= 5,
              })}
              disabled={regenerateMutation.isPending || isLoadingPrompt}
              className="gap-2"
              data-testid="button-confirm-generate"
            >
              {regenerateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate Image<CreditNote action="dish_photo" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The image will be permanently removed from this recipe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
