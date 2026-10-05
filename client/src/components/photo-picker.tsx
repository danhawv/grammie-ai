import { useRef, useState, type ReactNode } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The one photo picker (docs/DESIGN_PRINCIPLES.md §4): take a photo (phones)
// or choose from the library, plus drag and drop on desktop. Hands back the
// chosen files; callers shrink them with downscaleImage() before upload.

interface PhotoPickerProps {
  onPick: (files: File[]) => void;
  multiple?: boolean;
  /** Show the "Take photo" camera button (phones/tablets) */
  allowCamera?: boolean;
  disabled?: boolean;
  /** Drop zone body; defaults to a short prompt */
  children?: ReactNode;
  /** "zone" = large drop area; "buttons" = just the two buttons */
  variant?: "zone" | "buttons";
  className?: string;
  libraryLabel?: string;
}

export function PhotoPicker({
  onPick,
  multiple = true,
  allowCamera = true,
  disabled,
  children,
  variant = "zone",
  className,
  libraryLabel = "Choose photos",
}: PhotoPickerProps) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (files.length) onPick(multiple ? files : files.slice(0, 1));
  };

  const buttons = (
    <div className="flex flex-wrap justify-center gap-3">
      {allowCamera && (
        <Button type="button" variant="outline" disabled={disabled} onClick={() => cameraRef.current?.click()} className="md:hidden">
          <Camera aria-hidden /> Take photo
        </Button>
      )}
      <Button type="button" variant={variant === "zone" ? "default" : "outline"} disabled={disabled} onClick={() => libraryRef.current?.click()}>
        <ImagePlus aria-hidden /> {libraryLabel}
      </Button>
    </div>
  );

  return (
    <div className={className}>
      {variant === "zone" ? (
        <div
          className={cn(
            "flex flex-col items-center gap-4 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border",
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files); }}
        >
          {children ?? <p className="text-sm text-muted-foreground">Drag photos here, or</p>}
          {buttons}
        </div>
      ) : (
        buttons
      )}
      <input ref={libraryRef} type="file" accept="image/*" multiple={multiple} hidden onChange={(e) => { handle(e.target.files); e.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handle(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
