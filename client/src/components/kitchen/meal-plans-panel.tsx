import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Archive, ArchiveRestore, BookTemplate, CalendarDays, ChevronRight, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";
import { useHiddenIds } from "./use-hidden-ids";

export type MealPlanSummary = {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  startDate: string;
  endDate: string;
  isTemplate: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type View = "active" | "archived" | "templates";

const VIEW_LABELS: Record<View, string> = { active: "Current", archived: "Archived", templates: "Templates" };

/** This week's Monday as YYYY-MM-DD, in local time */
function thisMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + (day === 0 ? -6 : 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

export function formatPlanDates(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(end).toLocaleDateString(undefined, opts)}`;
}

export function MealPlansPanel() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const undoable = useUndoable();
  const { hidden, hide, show } = useHiddenIds();
  const [view, setView] = useState<View>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [templateToUse, setTemplateToUse] = useState<MealPlanSummary | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(thisMonday);

  const isTemplates = view === "templates";
  const { data: plans = [], isLoading, isError, refetch } = useQuery<MealPlanSummary[]>({
    queryKey: ["/api/meal-plans", view],
    queryFn: async () => {
      const params = new URLSearchParams(isTemplates ? { includeTemplates: "true", status: "active" } : { status: view });
      return (await apiRequest("GET", `/api/meal-plans?${params}`)).json();
    },
  });

  const visible = useMemo(
    () => plans.filter((p) => (isTemplates ? p.isTemplate : !p.isTemplate) && !hidden.has(p.id)),
    [plans, isTemplates, hidden],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const start = new Date(startDate);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6); // a 7-day plan
      const label = start.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
      const body = { name: name.trim() || `Week of ${label}`, startDate: start.toISOString() };
      const res = templateToUse
        ? await apiRequest("POST", `/api/meal-plans/from-template/${templateToUse.id}`, body)
        : await apiRequest("POST", "/api/meal-plans", { ...body, endDate: end.toISOString() });
      return res.json() as Promise<MealPlanSummary>;
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      setCreateOpen(false);
      setName("");
      navigate(`/meal-plans/${plan.id}`);
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "archived" }) =>
      apiRequest("PATCH", `/api/meal-plans/${id}`, { status }),
    onSuccess: (_d, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      toast({ title: status === "archived" ? "Moved to Archived" : "Moved back to Current" });
    },
    onError: () => toast({ title: "Couldn't move that plan", description: "Check your connection and try again.", variant: "destructive" }),
  });

  const removePlan = (plan: MealPlanSummary) =>
    undoable({
      message: `Deleted “${plan.name}”`,
      hide: () => hide([plan.id]),
      restore: () => show([plan.id]),
      commit: async () => {
        await apiRequest("DELETE", `/api/meal-plans/${plan.id}`);
        queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      },
    });

  const openCreate = (template: MealPlanSummary | null = null) => {
    setTemplateToUse(template);
    setName("");
    setStartDate(thisMonday());
    createMutation.reset();
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which plans to show">
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <Button key={v} variant={view === v ? "secondary" : "outline"} aria-pressed={view === v} onClick={() => setView(v)}>
              {VIEW_LABELS[v]}
            </Button>
          ))}
        </div>
        {/* The empty state carries the main action when there's nothing yet */}
        {!(view === "active" && !isLoading && !isError && visible.length === 0) && (
          <Button onClick={() => openCreate()} data-testid="button-new-meal-plan">
            <Plus aria-hidden />
            New meal plan
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading meal plans" rows={3} />
      ) : isError ? (
        <ErrorState title="Couldn't load your meal plans" onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={isTemplates ? BookTemplate : view === "archived" ? Archive : CalendarDays}
          title={isTemplates ? "No templates yet" : view === "archived" ? "No archived plans" : "No meal plans yet"}
          description={
            isTemplates
              ? "Open a meal plan and choose “Save as template” to reuse a week you liked."
              : view === "archived"
                ? "Plans you archive show up here."
                : "Plan the week's breakfasts, lunches and dinners from your recipes, then turn the whole week into one grocery list."
          }
          action={view === "active" ? <Button onClick={() => openCreate()}><Plus aria-hidden /> Plan this week</Button> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((plan) => (
            <li key={plan.id} className="flex items-center gap-1 rounded-lg border bg-card pr-1">
              <button
                type="button"
                onClick={() => (plan.isTemplate ? openCreate(plan) : navigate(`/meal-plans/${plan.id}`))}
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{plan.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {plan.isTemplate ? "Template · tap to start a week from it" : formatPlanDates(plan.startDate, plan.endDate)}
                  </span>
                  {plan.description && <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">{plan.description}</span>}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`More for ${plan.name}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {plan.isTemplate && (
                    <DropdownMenuItem className="min-h-11 text-base" onClick={() => openCreate(plan)}>
                      <CalendarDays className="mr-2 h-4 w-4" aria-hidden /> Start a week from this
                    </DropdownMenuItem>
                  )}
                  {!plan.isTemplate && plan.status !== "archived" && (
                    <DropdownMenuItem className="min-h-11 text-base" onClick={() => setStatus.mutate({ id: plan.id, status: "archived" })}>
                      <Archive className="mr-2 h-4 w-4" aria-hidden /> Archive
                    </DropdownMenuItem>
                  )}
                  {!plan.isTemplate && plan.status === "archived" && (
                    <DropdownMenuItem className="min-h-11 text-base" onClick={() => setStatus.mutate({ id: plan.id, status: "active" })}>
                      <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden /> Move back to Current
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className="min-h-11 text-base text-destructive focus:text-destructive" onClick={() => removePlan(plan)}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{templateToUse ? `Start a week from “${templateToUse.name}”` : "New meal plan"}</DialogTitle>
            <DialogDescription>A plan covers seven days, starting on the day you pick.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (startDate) createMutation.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="plan-name">Name (optional)</Label>
              <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Family dinners" className="h-11 text-base" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-start">First day</Label>
              <Input id="plan-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11 text-base" />
            </div>
            {createMutation.isError && (
              <p role="alert" className="text-sm text-destructive">Couldn't create the plan. Check your connection and try again.</p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!startDate || createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
                Create plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
