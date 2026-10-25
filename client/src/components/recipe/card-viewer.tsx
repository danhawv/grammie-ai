import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RotateCw, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/import-api";
import { mediaUrl } from "@/lib/platform";
import type { HeroImage } from "@/lib/recipe-images";
import { CarouselArrow } from "@/components/recipe-image-manager";

// A full-screen look at the handwritten card (and the recipe's photos) on a
// dark background. Pinch or double-tap to zoom, drag while zoomed, swipe or
// use the arrows to move between pictures. Owners can turn a sideways card.
// Gestures use pointer events so the same code runs in the browser and in
// the iPhone/iPad app.

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

type View = { scale: number; x: number; y: number };
const RESTING: View = { scale: 1, x: 0, y: 0 };

type Gesture = {
  pointers: Map<number, { x: number; y: number }>;
  startView: View;
  startPoint: { x: number; y: number };
  startDist: number;
  moved: boolean;
  lastTapAt: number;
  lastTapPoint: { x: number; y: number } | null;
};

export function CardViewer({
  open,
  onOpenChange,
  images,
  initialIndex,
  recipeId,
  canRotate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: HeroImage[];
  /** Which picture to start on each time the viewer opens */
  initialIndex: number;
  recipeId: string;
  /** Owner only: show the Rotate button on the card */
  canRotate: boolean;
}) {
  const { toast } = useToast();
  const [index, setIndex] = useState(initialIndex);
  const [view, setView] = useState<View>(RESTING);
  const [dragging, setDragging] = useState(false);
  // Quarter turns shown with CSS while the server saves the turned card
  const [pendingTurn, setPendingTurn] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const gesture = useRef<Gesture>({
    pointers: new Map(),
    startView: RESTING,
    startPoint: { x: 0, y: 0 },
    startDist: 0,
    moved: false,
    lastTapAt: 0,
    lastTapPoint: null,
  });

  const safeIndex = Math.min(index, Math.max(images.length - 1, 0));
  const current = images[safeIndex];

  // Start where the hero was, and come back to rest whenever the viewer opens
  useEffect(() => {
    if (open) {
      setIndex(initialIndex);
      setView(RESTING);
      setPendingTurn(0);
    }
  }, [open, initialIndex]);

  // The turned card arrives as a new picture, so the CSS turn is no longer needed
  useEffect(() => { setPendingTurn(0); }, [current?.url]);

  const goTo = (i: number) => {
    setIndex((i + images.length) % images.length);
    setView(RESTING);
    setPendingTurn(0);
  };
  const prev = () => images.length > 1 && goTo(safeIndex - 1);
  const next = () => images.length > 1 && goTo(safeIndex + 1);

  const rotate = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/recipes/${recipeId}/original-card/rotate`, { degrees: 90 });
    },
    onMutate: () => setPendingTurn((t) => (t + 90) % 360),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] }),
    onError: (err) => {
      setPendingTurn(0);
      toast({ title: "Couldn't turn the card", description: apiErrorMessage(err, "Check your connection and try again."), variant: "destructive" });
    },
  });

  // --- Gestures -----------------------------------------------------------

  /** Pointer position relative to the middle of the stage */
  const pointFor = (e: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  };

  /** Keep the picture from drifting off screen while zoomed */
  const clamp = (v: View): View => {
    const rect = stageRef.current?.getBoundingClientRect();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
    const boundX = rect ? ((scale - 1) * rect.width) / 2 : Infinity;
    const boundY = rect ? ((scale - 1) * rect.height) / 2 : Infinity;
    return {
      scale,
      x: Math.min(boundX, Math.max(-boundX, v.x)),
      y: Math.min(boundY, Math.max(-boundY, v.y)),
    };
  };

  /** Zoom to `scale` keeping the picture under `point` in place */
  const zoomAt = (from: View, scale: number, point: { x: number; y: number }, anchor = point): View => {
    const px = (anchor.x - from.x) / from.scale;
    const py = (anchor.y - from.y) / from.scale;
    return clamp({ scale, x: point.x - scale * px, y: point.y - scale * py });
  };

  const midpoint = (pts: Map<number, { x: number; y: number }>) => {
    const [a, b] = Array.from(pts.values());
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const distance = (pts: Map<number, { x: number; y: number }>) => {
    const [a, b] = Array.from(pts.values());
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const g = gesture.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, pointFor(e));
    g.startView = view;
    g.moved = false;
    if (g.pointers.size === 2) {
      g.startPoint = midpoint(g.pointers);
      g.startDist = distance(g.pointers);
    } else if (g.pointers.size === 1) {
      g.startPoint = pointFor(e);
    }
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, pointFor(e));
    if (g.pointers.size >= 2) {
      // Pinch: scale by the change in finger distance, follow the fingers' midpoint
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (g.startView.scale * distance(g.pointers)) / g.startDist));
      setView(zoomAt(g.startView, scale, midpoint(g.pointers), g.startPoint));
      g.moved = true;
    } else if (g.pointers.size === 1) {
      const p = pointFor(e);
      const dx = p.x - g.startPoint.x;
      const dy = p.y - g.startPoint.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.startView.scale > 1) {
        setView(clamp({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy }));
      }
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    const wasPinching = g.pointers.size >= 2;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size > 0) {
      // One finger lifted after a pinch: carry on panning from here
      g.startView = view;
      g.startPoint = Array.from(g.pointers.values())[0];
      return;
    }
    setDragging(false);
    if (cancelled || wasPinching) {
      if (view.scale < 1.05) setView(RESTING);
      return;
    }

    const p = pointFor(e);
    const dx = p.x - g.startPoint.x;
    const dy = p.y - g.startPoint.y;
    const now = Date.now();

    if (g.startView.scale === 1 && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      // Swipe between pictures (only when not zoomed in)
      if (dx < 0) next(); else prev();
      g.lastTapPoint = null;
      return;
    }

    if (!g.moved) {
      const last = g.lastTapPoint;
      if (last && now - g.lastTapAt < 300 && Math.hypot(p.x - last.x, p.y - last.y) < 30) {
        // Double tap: zoom in on that spot, or back out
        setView(view.scale > 1 ? RESTING : zoomAt(RESTING, DOUBLE_TAP_SCALE, p));
        g.lastTapPoint = null;
        g.lastTapAt = 0;
        return;
      }
      g.lastTapAt = now;
      g.lastTapPoint = p;
    }
    if (view.scale < 1.05) setView(RESTING);
  };

  // Mouse wheel / trackpad zoom. Added by hand (not onWheel) so the page
  // behind doesn't scroll: React registers wheel listeners as passive.
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // A trackpad pinch arrives as a wheel with ctrl held; a plain wheel zooms too
      const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.002));
      setView((v) => zoomAt(v, Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor)), pointFor(e)));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, current?.id]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
  };

  // A quarter turn shown with CSS swaps the picture's width and height, so
  // shrink it enough to still fit the screen until the saved copy arrives
  let turnFit = 1;
  if (pendingTurn % 180 !== 0 && imgRef.current && stageRef.current) {
    const img = imgRef.current;
    const stage = stageRef.current;
    turnFit = Math.min(1, stage.clientWidth / (img.clientHeight || 1), stage.clientHeight / (img.clientWidth || 1));
  }

  if (!current) return null;
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale * turnFit}) rotate(${pendingTurn}deg)`;
  const showRotate = canRotate && current.isCard;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
          data-testid="card-viewer"
        >
          <DialogPrimitive.Title className="sr-only">
            {current.isCard ? "Original recipe card" : "Recipe photo"}
          </DialogPrimitive.Title>

          <div className="safe-top relative z-10 flex items-center justify-between px-2 pt-2">
            <DialogPrimitive.Close
              className="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-base [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.6))] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              data-testid="button-card-viewer-close"
            >
              <X className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              Close
            </DialogPrimitive.Close>
            {showRotate && (
              <button
                type="button"
                onClick={() => rotate.mutate()}
                disabled={rotate.isPending}
                className="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-base [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.6))] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-70"
                title="Turn the card a quarter turn clockwise"
                data-testid="button-card-viewer-rotate"
              >
                {rotate.isPending ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden /> : <RotateCw className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                Rotate
              </button>
            )}
          </div>

          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden [touch-action:none] select-none"
            style={{ cursor: view.scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endPointer(e, false)}
            onPointerCancel={(e) => endPointer(e, true)}
          >
            <img
              ref={imgRef}
              key={current.id}
              src={mediaUrl(current.url)}
              alt={current.isCard ? "Original recipe card, full size" : "Recipe photo, full size"}
              draggable={false}
              className={`max-h-full max-w-full object-contain ${dragging ? "" : "motion-safe:transition-transform motion-safe:duration-200"}`}
              style={{ transform, transformOrigin: "center", willChange: "transform" }}
              data-testid="img-card-viewer"
            />
            {images.length > 1 && (
              <>
                <CarouselArrow direction="prev" label="Previous picture" onClick={prev} className="absolute left-1 top-1/2 -translate-y-1/2" testId="button-card-viewer-prev" />
                <CarouselArrow direction="next" label="Next picture" onClick={next} className="absolute right-1 top-1/2 -translate-y-1/2" testId="button-card-viewer-next" />
              </>
            )}
          </div>

          <div className="safe-bottom flex min-h-11 items-center justify-center px-4 pb-2 text-sm text-white/80" aria-live="polite">
            {images.length > 1 && <span data-testid="text-card-viewer-count">{safeIndex + 1} of {images.length}</span>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
