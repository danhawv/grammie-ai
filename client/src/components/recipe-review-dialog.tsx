import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Check, Wand2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { lintIngredients, type IngredientIssue, type NormalizedIngredientLike } from "@shared/ingredient-lint";

// Pre-print review: scans every recipe in the cookbook for ingredient lines
// that would look wrong in a printed book (AI-normalization artifacts like
// "24 cookies Oreo cookies") and lets the user fix them before generating.

interface ReviewRecipe {
  id: string;
  title: string;
  normalizedIngredients: NormalizedIngredientLike[] | null;
}

interface RecipeIssues {
  recipe: ReviewRecipe;
  issues: IngredientIssue[];
}

export function RecipeReviewDialog({ cookbookId, open, onClose }: {
  cookbookId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [fixedKeys, setFixedKeys] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ recipes: ReviewRecipe[] }>({
    queryKey: ['/api/cookbooks', cookbookId, 'recipes', 'print'],
    queryFn: async () => {
      const res = await fetch(`/api/cookbooks/${cookbookId}/recipes/print`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load recipes');
      return res.json();
    },
    enabled: open && cookbookId > 0,
  });

  const recipeIssues: RecipeIssues[] = useMemo(() => {
    if (!data?.recipes) return [];
    return data.recipes
      .map((recipe) => ({ recipe, issues: lintIngredients(recipe.normalizedIngredients) }))
      .filter((r) => r.issues.length > 0);
  }, [data]);

  const totalIssues = recipeIssues.reduce((n, r) => n + r.issues.length, 0);
  const remainingIssues = recipeIssues.reduce(
    (n, r) => n + r.issues.filter((iss) => !fixedKeys.has(`${r.recipe.id}:${iss.index}`)).length,
    0
  );

  const applyFix = async (recipe: ReviewRecipe, issue: IngredientIssue, patch: Partial<NormalizedIngredientLike>) => {
    const key = `${recipe.id}:${issue.index}`;
    setSavingKey(key);
    try {
      const updated = (recipe.normalizedIngredients || []).map((ing, i) =>
        i === issue.index ? { ...ing, ...patch } : ing
      );
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ normalizedIngredients: updated }),
      });
      if (!res.ok) throw new Error('Save failed');
      recipe.normalizedIngredients = updated; // keep local scan state consistent
      setFixedKeys((prev) => new Set(prev).add(key));
    } catch {
      toast({ title: "Couldn't save fix", variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const fixAll = async () => {
    for (const { recipe, issues } of recipeIssues) {
      for (const issue of issues) {
        const key = `${recipe.id}:${issue.index}`;
        if (issue.fix && !fixedKeys.has(key)) {
          await applyFix(recipe, issue, issue.fix);
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'recipes', 'print'] });
    toast({ title: "Fixes applied", description: "All auto-fixable ingredient lines were cleaned up." });
  };

  const handleClose = () => {
    if (fixedKeys.size > 0) {
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'recipes', 'print'] });
    }
    setFixedKeys(new Set());
    setManualEdits({});
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" data-testid="recipe-review-dialog">
        <DialogHeader>
          <DialogTitle>Review recipes before printing</DialogTitle>
          <DialogDescription>
            {isLoading
              ? 'Scanning ingredient lines…'
              : totalIssues === 0
                ? 'No issues found — your ingredient lines look print-ready.'
                : `${remainingIssues} of ${totalIssues} flagged ingredient line${totalIssues === 1 ? '' : 's'} to review. These would print oddly in the book.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : totalIssues > 0 ? (
          <>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={fixAll} data-testid="fix-all-issues">
                <Wand2 className="w-3.5 h-3.5" />
                Fix all automatically
              </Button>
            </div>
            <ScrollArea className="flex-1 -mx-2 px-2">
              <div className="space-y-4 pb-2">
                {recipeIssues.map(({ recipe, issues }) => (
                  <div key={recipe.id}>
                    <h4 className="text-sm font-semibold mb-1.5">{recipe.title}</h4>
                    <div className="space-y-1.5">
                      {issues.map((issue) => {
                        const key = `${recipe.id}:${issue.index}`;
                        const fixed = fixedKeys.has(key);
                        const saving = savingKey === key;
                        return (
                          <div key={key} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                            {fixed ? (
                              <>
                                <Check className="w-4 h-4 text-green-600 shrink-0" />
                                <span className="text-muted-foreground">{issue.suggestedDisplay || manualEdits[key] || issue.display}</span>
                              </>
                            ) : issue.fix ? (
                              <>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="line-through text-muted-foreground">{issue.display}</span>
                                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                    <span className="font-medium">{issue.suggestedDisplay}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{issue.message}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={saving}
                                  onClick={() => applyFix(recipe, issue, issue.fix!)}
                                  data-testid={`fix-${key}`}
                                >
                                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Fix'}
                                </Button>
                              </>
                            ) : (
                              <>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-muted-foreground mb-1">{issue.message}</p>
                                  <Input
                                    className="h-7 text-sm"
                                    placeholder="Type the ingredient name…"
                                    value={manualEdits[key] ?? ''}
                                    onChange={(e) => setManualEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={saving || !(manualEdits[key] ?? '').trim()}
                                  onClick={() => applyFix(recipe, issue, { item: manualEdits[key].trim() })}
                                >
                                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                                </Button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
