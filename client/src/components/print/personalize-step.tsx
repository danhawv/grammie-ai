import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FamilyPhotosPanel } from "@/components/family-photos-panel";
import type { FamilyPhotoEntry, PrintLayoutData } from "@shared/schema";
import type { BookDraft } from "./types";

// Step 3: the words on the first pages, and family photos.

interface PersonalizeStepProps {
  cookbookId: number;
  draft: BookDraft;
  updateLayout: (change: Partial<PrintLayoutData>) => void;
  recipeTitles: Map<string, string>;
}

export function PersonalizeStep({ cookbookId, draft, updateLayout, recipeTitles }: PersonalizeStepProps) {
  const l = draft.layoutData;
  return (
    <div className="space-y-8">
      <section aria-labelledby="cover-heading" className="space-y-4">
        <h2 id="cover-heading" className="text-xl font-semibold">Cover and title page</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Book title</Label>
            <Input id="title" placeholder="e.g. The Miller Family Kitchen" value={l.title || ""} onChange={(e) => updateLayout({ title: e.target.value })} data-testid="input-title" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subtitle">Subtitle (optional)</Label>
            <Input id="subtitle" placeholder="e.g. Recipes from three generations" value={l.subtitle || ""} onChange={(e) => updateLayout({ subtitle: e.target.value })} data-testid="input-subtitle" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="author">Author</Label>
          <Input id="author" autoComplete="name" placeholder="e.g. Jean Miller and family" value={l.authorName || ""} onChange={(e) => updateLayout({ authorName: e.target.value })} data-testid="input-author" />
          <p className="text-sm text-muted-foreground">Printed on the cover and title page.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dedication">Dedication (optional)</Label>
          <Textarea
            id="dedication"
            placeholder="e.g. For Grandma, who taught us all to cook"
            value={l.dedication || ""}
            onChange={(e) => updateLayout({ dedication: e.target.value })}
            className="resize-y text-base"
            rows={3}
            data-testid="input-dedication"
          />
          <p className="text-sm text-muted-foreground">Gets its own page near the front of the book.</p>
        </div>
      </section>

      <FamilyPhotosPanel
        cookbookId={cookbookId}
        layoutData={l}
        onChange={(familyPhotos: FamilyPhotoEntry[]) => updateLayout({ familyPhotos })}
        templateStyle={draft.templateStyle}
        customTemplateId={draft.customTemplateId}
        recipeTitles={recipeTitles}
      />
    </div>
  );
}
