import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

// Finds recipes with identical titles and lets the user merge each group:
// one survivor keeps all cookbook memberships, meal-plan entries, and
// bookmarks from the duplicates being removed.

interface DupRecipe {
  id: string;
  title: string;
  createdAt: string;
  dishImageThumbnail: string | null;
  hasNormalized: boolean;
  cookbooks: string[];
}

interface DupGroup {
  title: string;
  recipes: DupRecipe[];
}

/** Default keeper: in the most cookbooks, then richest data, then newest */
function defaultKeeper(group: DupGroup): string {
  const scored = [...group.recipes].sort((a, b) =>
    (b.cookbooks.length - a.cookbooks.length) ||
    (Number(b.hasNormalized) - Number(a.hasNormalized)) ||
    (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  );
  return scored[0].id;
}

export function DuplicateRecipesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [mergedTitles, setMergedTitles] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<{ groups: DupGroup[] }>({
    queryKey: ["/api/recipes/duplicates"],
    enabled: open,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ keepId, removeIds }: { keepId: string; removeIds: string[] }) => {
      const res = await fetch("/api/recipes/merge-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keepId, removeIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Merge failed");
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/duplicates"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/recipes") || String(q.queryKey[0]).startsWith("/api/cookbooks") });
      toast({ title: "Merged", description: `Removed ${vars.removeIds.length} duplicate${vars.removeIds.length === 1 ? "" : "s"}.` });
    },
    onError: (e: any) => toast({ title: "Couldn't merge", description: e.message, variant: "destructive" }),
  });

  const groups = data?.groups ?? [];

  const mergeGroup = (group: DupGroup) => {
    const keepId = keepers[group.title] || defaultKeeper(group);
    const removeIds = group.recipes.filter((r) => r.id !== keepId).map((r) => r.id);
    setMergedTitles((prev) => new Set(prev).add(group.title));
    mergeMutation.mutate({ keepId, removeIds });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" data-testid="duplicates-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5" />
            Duplicate recipes
          </DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Scanning your recipes…"
              : groups.length === 0
                ? "No duplicates found — every recipe title is unique."
                : `${groups.length} set${groups.length === 1 ? "" : "s"} of recipes share a title. Pick which copy to keep — its duplicates' cookbook placements, meal plans, and bookmarks move to the keeper.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : groups.length > 0 ? (
          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="space-y-5 pb-2">
              {groups.map((group) => {
                const keepId = keepers[group.title] || defaultKeeper(group);
                const merged = mergedTitles.has(group.title);
                return (
                  <div key={group.title} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h4 className="font-semibold text-sm truncate">{group.title}</h4>
                      {merged ? (
                        <Badge variant="secondary" className="gap-1"><Check className="w-3 h-3" /> merged</Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => mergeGroup(group)}
                          disabled={mergeMutation.isPending}
                          data-testid={`merge-${group.recipes[0].id}`}
                        >
                          Keep selected, remove {group.recipes.length - 1}
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.recipes.map((r) => (
                        <label
                          key={r.id}
                          className={`flex gap-2.5 items-start border rounded-md p-2 cursor-pointer transition-colors ${keepId === r.id ? "border-primary bg-primary/5" : "hover:bg-accent/50"} ${merged ? "opacity-60 pointer-events-none" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`keep-${group.title}`}
                            checked={keepId === r.id}
                            onChange={() => setKeepers((prev) => ({ ...prev, [group.title]: r.id }))}
                            className="mt-1"
                          />
                          {r.dishImageThumbnail && (
                            <img src={r.dishImageThumbnail} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                          )}
                          <div className="min-w-0 text-xs space-y-0.5">
                            <p className="font-medium">{keepId === r.id ? "Keep this one" : "Remove"}</p>
                            <p className="text-muted-foreground">Added {new Date(r.createdAt).toLocaleDateString()}</p>
                            <p className="text-muted-foreground truncate">
                              {r.cookbooks.length > 0 ? `In: ${r.cookbooks.join(", ")}` : "Not in any cookbook"}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
