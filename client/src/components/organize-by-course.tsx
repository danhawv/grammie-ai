import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, LayoutList, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Sidebar card in the print editor: proposes book chapters by course
// (Breakfast, Mains, Desserts...) and replaces the current sections only
// after the user reviews the plan. Each chapter prints with its own title
// page via the existing section-divider page.

interface PlannedChapter {
  key: string;
  title: string;
  recipeIds: string[];
  recipeTitles: string[];
}

export function OrganizeByCourse({ cookbookId, hasExistingSections, onApply }: {
  cookbookId: number;
  hasExistingSections: boolean;
  onApply: (sections: { id: string; title: string; recipeIds: string[] }[]) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<{ chapters: PlannedChapter[]; classified: number; total: number } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const buildPlan = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cookbooks/${cookbookId}/course-plan`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to organize");
      setPlan(await res.json());
    } catch (e: any) {
      toast({ title: "Couldn't organize recipes", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!plan) return;
    onApply(plan.chapters.map((c) => ({ id: `course-${c.key}`, title: c.title, recipeIds: c.recipeIds })));
    toast({
      title: "Organized by course",
      description: `${plan.chapters.length} chapters, each with its own title page. You can still drag recipes between them.`,
    });
    setPlan(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Organize by Course</CardTitle>
          <CardDescription>
            Sort recipes into chapters like Breakfast, Mains, and Desserts. Each chapter gets its own title page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={buildPlan}
            disabled={loading}
            data-testid="button-organize-by-course"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LayoutList className="w-4 h-4" />}
            {loading ? "Sorting recipes…" : "Organize by course"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={!!plan} onOpenChange={(o) => { if (!o) setPlan(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col" data-testid="course-plan-dialog">
          <DialogHeader>
            <DialogTitle>Proposed chapters</DialogTitle>
            <DialogDescription>
              {plan && `${plan.total} recipes in ${plan.chapters.length} chapters.`}
              {plan && plan.classified > 0 && ` ${plan.classified} untagged recipe${plan.classified === 1 ? " was" : "s were"} sorted by AI.`}
              {hasExistingSections && " Applying replaces your current sections."}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="space-y-1.5 pb-1">
              {plan?.chapters.map((c) => (
                <div key={c.key} className="border rounded-md">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-sm"
                    onClick={() => setExpanded(expanded === c.key ? null : c.key)}
                  >
                    <span className="font-medium">{c.title}</span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {c.recipeIds.length} recipe{c.recipeIds.length === 1 ? "" : "s"}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded === c.key ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {expanded === c.key && (
                    <ul className="px-3 pb-2 text-xs text-muted-foreground space-y-0.5">
                      {c.recipeTitles.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)}>Cancel</Button>
            <Button onClick={apply} data-testid="button-apply-course-plan">Use these chapters</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
