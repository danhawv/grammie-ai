import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, MoreHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TemplateDesigner } from "@/components/template-designer";
import { TemplateFromPhotos } from "@/components/template-from-photos";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";
import { cn } from "@/lib/utils";
import type { CustomTemplate } from "@shared/schema";
import type { BookDraft } from "./types";
import { apiFetch } from "@/lib/platform";

// "Your own styles": templates copied from photos of a cookbook, designed by
// hand, or saved earlier. The built-in styles are picked on the cover step.

interface CustomStylesProps {
  cookbookId: number;
  draft: BookDraft;
  update: (change: Partial<BookDraft>) => void;
}

export function CustomStyles({ draft, update }: CustomStylesProps) {
  const { toast } = useToast();
  const undoable = useUndoable();
  const { data: customTemplates = [] } = useQuery<CustomTemplate[]>({ queryKey: ["/api/templates"] });
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [designerOpen, setDesignerOpen] = useState(false);
  const [editing, setEditing] = useState<CustomTemplate | null>(null);

  const { customTemplateId } = draft;

  const deleteTemplate = (t: CustomTemplate) => {
    const wasSelected = customTemplateId === t.id;
    undoable({
      message: `Deleted “${t.name}”`,
      hide: () => {
        setHidden((prev) => new Set(prev).add(t.id));
        if (wasSelected) update({ customTemplateId: null });
      },
      restore: () => {
        setHidden((prev) => { const n = new Set(prev); n.delete(t.id); return n; });
        if (wasSelected) update({ customTemplateId: t.id });
      },
      commit: async () => {
        const res = await apiFetch(`/api/templates/${t.id}`, { method: "DELETE", credentials: "include" });
        if (res.status === 409) {
          // Another cookbook uses it: keep it, and say why
          setHidden((prev) => { const n = new Set(prev); n.delete(t.id); return n; });
          toast({ title: `Kept “${t.name}”`, description: "Another cookbook uses this template, so it wasn't deleted." });
          return;
        }
        if (!res.ok && res.status !== 204) throw new Error("Delete failed");
        queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      },
    });
  };

  const visibleCustom = customTemplates.filter((t) => !hidden.has(t.id));


  return (
    <div className="space-y-4">
      {visibleCustom.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="list">
          {visibleCustom.map((t) => {
            const on = customTemplateId === t.id;
            return (
              <li key={t.id} className={cn("flex items-start gap-1 rounded-lg border", on ? "border-primary bg-primary/5 ring-1 ring-primary" : "")}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ customTemplateId: t.id })}
                  className="flex min-h-11 flex-1 items-start gap-3 rounded-lg p-4 text-left hover:bg-accent/50"
                >
                  <span className="flex-1">
                    <span className="block font-medium">{t.name}</span>
                    {t.description && <span className="mt-1 block text-sm text-muted-foreground">{t.description}</span>}
                  </span>
                  {on && <Check className="h-5 w-5 shrink-0 text-primary" aria-label="Selected" />}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="m-1" aria-label={`Options for ${t.name}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditing(t); setDesignerOpen(true); }}>Edit style</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => deleteTemplate(t)} data-testid={`delete-template-${t.id}`}>
                      Delete style
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TemplateFromPhotos onCreated={(t) => update({ customTemplateId: t.id })} />
        <Button
          variant="outline"
          className="w-full"
          data-testid="design-custom-template"
          onClick={() => { setEditing(null); setDesignerOpen(true); }}
        >
          <Sparkles aria-hidden /> Design your own
        </Button>
      </div>

      <TemplateDesigner
        open={designerOpen}
        onOpenChange={setDesignerOpen}
        editingTemplate={editing}
        onSaved={(t) => update({ customTemplateId: t.id })}
      />
    </div>
  );
}
