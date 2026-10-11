import { useRef, useState, type ReactNode } from "react";
import { Camera, FolderOpen, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The one photo picker (docs/DESIGN_PRINCIPLES.md §4): take a photo (phones)
// or choose from the library, plus drag and drop on desktop. Hands back the
// chosen files; callers shrink them with downscaleImage() before upload.
// With `bulk`, it also takes a whole folder or .zip files (bulk intake) and
// hands back the raw drop, so folders inside it can be opened.

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
  /** Folders and .zip files too: drops arrive whole through onDropBulk */
  bulk?: { onDropBulk: (drop: DataTransfer) => void };
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
  bulk,
}: PhotoPickerProps) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(
      (f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name) || (bulk && /\.zip$/i.test(f.name)),
    );
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
      {bulk && (
        // Phones can't pick folders; photos (or a .zip) from the library work there
        <Button type="button" variant="outline" disabled={disabled} onClick={() => folderRef.current?.click()} className="hidden md:inline-flex">
          <FolderOpen aria-hidden /> Choose a folder
        </Button>
      )}
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
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (disabled) return;
            if (bulk) bulk.onDropBulk(e.dataTransfer);
            else handle(e.dataTransfer.files);
          }}
        >
          {children ?? <p className="text-sm text-muted-foreground">Drag photos here, or</p>}
          {buttons}
        </div>
      ) : (
        buttons
      )}
      <input ref={libraryRef} type="file" accept={bulk ? "image/*,.heic,.heif,.zip,application/zip" : "image/*"} multiple={multiple} hidden onChange={(e) => { handle(e.target.files); e.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handle(e.target.files); e.target.value = ""; }} />
      {bulk && (
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          // Folder picking (every current desktop browser supports it)
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => { if (e.target.files?.length) onPick(Array.from(e.target.files)); e.target.value = ""; }}
        />
      )}
    </div>
  );
}
