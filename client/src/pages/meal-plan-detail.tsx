import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  BarChart3,
  BookTemplate,
  Clock,
  Loader2,
  Minus,
  MoreHorizontal,
  PenLine,
  Plus,
  Recycle,
  ShoppingCart,
  Trash2,
  Users,
  Utensils,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { RecipePicker } from "@/components/meal-plan/recipe-picker";
import NutritionDashboard from "@/components/meal-plan/nutrition-dashboard";
import { MealPlanCollaborators } from "@/components/meal-plan/collaborators";
import { formatPlanDates } from "@/components/kitchen/meal-plans-panel";
import { useHiddenIds } from "@/components/kitchen/use-hidden-ids";
import { useMealPlanWebSocket } from "@/hooks/use-meal-plan-websocket";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
const SLOT_LABELS: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

// "40 mins" → "40 min", "1 hour 40 mins" → "1 hr 40 min"
function formatTime(timeStr: string): string {
  const lower = timeStr.toLowerCase().trim();
  const h = lower.match(/(\d+)\s*h(?:ou)?r?s?/);
  const m = lower.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);
  let hours = h ? parseInt(h[1]) : 0;
  let mins = m ? parseInt(m[1]) : 0;
  if (!hours && !mins) {
    const plain = lower.match(/^(\d+)$/);
    if (!plain) return timeStr;
    mins = parseInt(plain[1]);
  }
  if (mins >= 60) { hours += Math.floor(mins / 60); mins %= 60; }
  if (hours && mins) return `${hours} hr ${mins} min`;
  if (hours) return `${hours} hr`;
  return `${mins} min`;
}

type MealPlanEntry = {
  id: string;
  mealPlanId: string;
  date: string;
  mealSlot: string;
  position: number;
  recipeId: string | null;
  scaledServings: number | null;
  isLeftover: boolean;
  customMealName: string | null;
  notes: string | null;
  assignedUserId?: string | null;
  recipe?: any;
  assignedUser?: any;
};

type MealPlanWithEntries = {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  ownerUserId: string;
  status: string;
  entries: MealPlanEntry[];
  collaborators?: any[];
};

const dateKeyOf = (d: Date | string) => new Date(d).toISOString().split("T")[0];
const dayLabel = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
const entryTitle = (e: MealPlanEntry) => e.recipe?.title || e.customMealName || "Meal";

// ---------------------------------------------------------------------------
// Entry cards
// ---------------------------------------------------------------------------

function EntryContent({ entry, compact }: { entry: MealPlanEntry; compact?: boolean }) {
  const servings = entry.scaledServings || entry.recipe?.servings || null;
  const image = entry.recipe?.dishImageThumbnail || entry.recipe?.dishImage || null;
  return (
    <>
      {!compact && (image ? (
        <img src={image} alt="" className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted/50">
          <Utensils className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
      ))}
      <span className="block px-2 py-1.5 text-left">
        <span className="line-clamp-2 block text-sm font-medium leading-snug">{entryTitle(entry)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {entry.isLeftover && (
            <span className="inline-flex items-center gap-0.5 font-medium text-green-800 dark:text-green-300">
              <Recycle className="h-3.5 w-3.5" aria-hidden /> Leftovers
            </span>
          )}
          {servings && <span>Serves {servings}</span>}
          {entry.recipe?.totalTime && <span>{formatTime(entry.recipe.totalTime)}</span>}
        </span>
      </span>
    </>
  );
}

/** Desktop grid card: drag to move, click to open */
function DraggableEntry({ entry, onOpen }: { entry: MealPlanEntry; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: entry.id });
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      aria-label={`${entryTitle(entry)} — open to change or move`}
      className="block w-full cursor-grab overflow-hidden rounded-lg border bg-card text-left shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <EntryContent entry={entry} />
    </button>
  );
}

function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`min-w-0 rounded p-1 transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""}`}>
      {children}
    </div>
  );
}

function AddMenu({ label, onRecipe, onCustom, className }: { label: string; onRecipe: () => void; onCustom: () => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`w-full border-dashed text-muted-foreground ${className || ""}`} aria-label={label}>
          <Plus aria-hidden /> Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem className="min-h-11 text-base" onClick={onRecipe}>
          <Utensils className="mr-2 h-4 w-4" aria-hidden /> A recipe
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 text-base" onClick={onCustom}>
          <PenLine className="mr-2 h-4 w-4" aria-hidden /> A note (“Eating out”)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Entry details: servings, leftovers, who's cooking, move, remove
// ---------------------------------------------------------------------------

function EntryDialog({
  entry,
  days,
  assignable,
  onClose,
  onUpdate,
  onMove,
  onRemove,
}: {
  entry: MealPlanEntry | null;
  days: Date[];
  assignable: { userId: string; displayName: string }[];
  onClose: () => void;
  onUpdate: (updates: Record<string, unknown>) => void;
  onMove: (date: string, slot: string) => void;
  onRemove: () => void;
}) {
  const [moveDay, setMoveDay] = useState("");
  const [moveSlot, setMoveSlot] = useState("");
  if (!entry) return null;
  const recipe = entry.recipe;
  const servings = entry.scaledServings || recipe?.servings || 1;
  const currentDay = dateKeyOf(entry.date);
  const targetDay = moveDay || currentDay;
  const targetSlot = moveSlot || entry.mealSlot;
  const moved = targetDay !== currentDay || targetSlot !== entry.mealSlot;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { setMoveDay(""); setMoveSlot(""); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entryTitle(entry)}</DialogTitle>
          <DialogDescription>
            {SLOT_LABELS[entry.mealSlot]}, {dayLabel(new Date(entry.date), { weekday: "long", month: "short", day: "numeric" })}
          </DialogDescription>
        </DialogHeader>

        {recipe && (recipe.dishImage || recipe.dishImageThumbnail) && (
          <img src={recipe.dishImage || recipe.dishImageThumbnail} alt="" className="aspect-video w-full rounded-lg object-cover" />
        )}
        {recipe?.totalTime && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <Clock className="h-4 w-4" aria-hidden /> {formatTime(recipe.totalTime)}
          </p>
        )}

        <div className="space-y-5">
          {recipe && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-medium" id="servings-label">Servings</span>
              <div className="flex items-center gap-2" role="group" aria-labelledby="servings-label">
                <Button variant="outline" size="icon" aria-label="Fewer servings" disabled={servings <= 1}
                  onClick={() => onUpdate({ scaledServings: Math.max(1, servings - 1) })}>
                  <Minus aria-hidden />
                </Button>
                <span className="w-8 text-center text-lg font-semibold" aria-live="polite">{servings}</span>
                <Button variant="outline" size="icon" aria-label="More servings" onClick={() => onUpdate({ scaledServings: servings + 1 })}>
                  <Plus aria-hidden />
                </Button>
              </div>
            </div>
          )}

          <Button variant="outline" className="w-full justify-start" aria-pressed={entry.isLeftover}
            onClick={() => onUpdate({ isLeftover: !entry.isLeftover })}>
            <Recycle aria-hidden />
            {entry.isLeftover ? "Leftovers (not added to the grocery list) — tap to undo" : "Mark as leftovers (skip on the grocery list)"}
          </Button>

          {assignable.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor="entry-cook">Who's cooking?</Label>
              <Select value={entry.assignedUserId || "none"} onValueChange={(v) => onUpdate({ assignedUserId: v === "none" ? null : v })}>
                <SelectTrigger id="entry-cook" className="h-11 text-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="min-h-11 text-base">Nobody yet</SelectItem>
                  {assignable.map((u) => (
                    <SelectItem key={u.userId} value={u.userId} className="min-h-11 text-base">{u.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-base font-medium">Move to</legend>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="move-day" className="sr-only">Day</Label>
                <Select value={targetDay} onValueChange={setMoveDay}>
                  <SelectTrigger id="move-day" className="h-11 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {days.map((d) => (
                      <SelectItem key={dateKeyOf(d)} value={dateKeyOf(d)} className="min-h-11 text-base">
                        {dayLabel(d, { weekday: "long", month: "short", day: "numeric" })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-36">
                <Label htmlFor="move-slot" className="sr-only">Meal</Label>
                <Select value={targetSlot} onValueChange={setMoveSlot}>
                  <SelectTrigger id="move-slot" className="h-11 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEAL_SLOTS.map((s) => <SelectItem key={s} value={s} className="min-h-11 text-base">{SLOT_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={!moved} onClick={() => { onMove(targetDay, targetSlot); setMoveDay(""); setMoveSlot(""); }}>
                Move
              </Button>
            </div>
          </fieldset>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" className="text-destructive" onClick={onRemove}>
            <Trash2 aria-hidden /> Remove from plan
          </Button>
          <div className="flex gap-2">
            {recipe && (
              <Button asChild variant="outline">
                <Link href={`/recipe/${recipe.id}`}>Open recipe</Link>
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MealPlanDetailPage() {
  const [, params] = useRoute("/meal-plans/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const undoable = useUndoable();
  const { hidden, hide, show } = useHiddenIds();
  const planId = params?.id;
  const planKey = ["/api/meal-plans", planId];

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ date: string; slot: string } | null>(null);
  const [customSlot, setCustomSlot] = useState<{ date: string; slot: string } | null>(null);
  const [customName, setCustomName] = useState("");
  const [groceryOpen, setGroceryOpen] = useState(false);
  const [groceryExcludePantry, setGroceryExcludePantry] = useState(true);
  const [groceryMode, setGroceryMode] = useState<"add_to_existing" | "create_new">("add_to_existing");
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const { user } = useAuth();
  const { onlineUsers } = useMealPlanWebSocket({ planId: planId || "", userId: user?.id || "", enabled: !!planId && !!user?.id });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: plan, isLoading, isError, error, refetch } = useQuery<MealPlanWithEntries>({
    queryKey: planKey,
    queryFn: async () => (await apiRequest("GET", `/api/meal-plans/${planId}`)).json(),
    enabled: !!planId,
    retry: (count, err) => !String((err as Error)?.message).startsWith("404") && count < 2,
  });

  const days = useMemo(() => {
    if (!plan) return [] as Date[];
    const out: Date[] = [];
    const current = new Date(plan.startDate);
    const end = new Date(plan.endDate);
    while (current <= end && out.length < 31) {
      out.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return out;
  }, [plan]);

  const entriesByCell = useMemo(() => {
    const map = new Map<string, MealPlanEntry[]>();
    for (const entry of plan?.entries ?? []) {
      if (hidden.has(entry.id)) continue;
      const key = `${dateKeyOf(entry.date)}|${entry.mealSlot}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [plan, hidden]);

  const assignable = useMemo(() => {
    const list: { userId: string; displayName: string }[] = [];
    if (user) list.push({ userId: user.id, displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Me" });
    for (const c of plan?.collaborators ?? []) {
      if (c.userId !== user?.id) list.push({ userId: c.userId, displayName: c.user?.displayName || c.user?.email || "Family member" });
    }
    return list;
  }, [plan, user]);

  const failed = (what: string) => () =>
    toast({ title: `Couldn't ${what}`, description: "Check your connection and try again.", variant: "destructive" });

  const addEntry = useMutation({
    mutationFn: async (body: { date: string; mealSlot: string; recipeId?: string; scaledServings?: number; customMealName?: string }) =>
      apiRequest("POST", `/api/meal-plans/${planId}/entries`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: planKey }),
    onError: failed("add that meal"),
  });

  const updateEntry = useMutation({
    mutationFn: async ({ entryId, updates }: { entryId: string; updates: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/meal-plans/${planId}/entries/${entryId}`, updates),
    onMutate: async ({ entryId, updates }) => {
      await queryClient.cancelQueries({ queryKey: planKey });
      const previous = queryClient.getQueryData(planKey);
      queryClient.setQueryData(planKey, (old: any) =>
        old ? { ...old, entries: old.entries.map((e: any) => (e.id === entryId ? { ...e, ...updates } : e)) } : old,
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(planKey, ctx.previous);
      failed("save that change")();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: planKey }),
  });

  const moveEntry = useMutation({
    mutationFn: async ({ entryId, date, mealSlot }: { entryId: string; date: string; mealSlot: string }) =>
      apiRequest("PATCH", `/api/meal-plans/${planId}/entries/${entryId}/move`, { date, mealSlot, position: 0 }),
    onMutate: async ({ entryId, date, mealSlot }) => {
      await queryClient.cancelQueries({ queryKey: planKey });
      const previous = queryClient.getQueryData(planKey);
      queryClient.setQueryData(planKey, (old: any) =>
        old ? { ...old, entries: old.entries.map((e: any) => (e.id === entryId ? { ...e, date, mealSlot, position: 0 } : e)) } : old,
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(planKey, ctx.previous);
      failed("move that meal")();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: planKey }),
  });

  const generateGrocery = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/meal-plans/${planId}/generate-grocery-list`, {
        excludeLeftovers: true,
        excludePantryItems: groceryExcludePantry,
        mode: groceryMode,
      })).json(),
    onSuccess: () => {
      setGroceryOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      toast({ title: "Grocery list ready" });
      navigate("/kitchen?tab=grocery");
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/meal-plans/${planId}/save-as-template`, { templateName: templateName.trim() }),
    onSuccess: () => {
      setTemplateOpen(false);
      setTemplateName("");
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      toast({ title: "Saved as a template", description: "Find it under Kitchen → Meal plans → Templates." });
    },
  });

  const removeEntry = (entry: MealPlanEntry) => {
    setOpenEntryId(null);
    undoable({
      message: `Removed ${entryTitle(entry)}`,
      hide: () => hide([entry.id]),
      restore: () => show([entry.id]),
      commit: async () => {
        await apiRequest("DELETE", `/api/meal-plans/${planId}/entries/${entry.id}`);
        queryClient.invalidateQueries({ queryKey: planKey });
      },
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;
    const [date, mealSlot] = String(over.id).split("|");
    const entry = plan?.entries.find((e) => e.id === active.id);
    if (!date || !mealSlot || !entry) return;
    if (dateKeyOf(entry.date) === date && entry.mealSlot === mealSlot) return;
    moveEntry.mutate({ entryId: String(active.id), date, mealSlot });
  };

  const addCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSlot || !customName.trim()) return;
    addEntry.mutate({ date: customSlot.date, mealSlot: customSlot.slot, customMealName: customName.trim() });
    setCustomSlot(null);
    setCustomName("");
  };

  const back = { href: "/kitchen?tab=meal-plans", label: "Meal plans" };

  if (!planId || isLoading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <PageHeader title="Meal plan" back={back} />
        <LoadingState label="Loading your meal plan" variant="cards" rows={3} />
      </div>
    );
  }

  if (isError || !plan) {
    const notFound = String((error as Error)?.message).startsWith("404");
    return (
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <PageHeader title="Meal plan" back={back} />
        {notFound ? (
          <EmptyState
            icon={Utensils}
            title="This meal plan isn't here"
            description="It may have been deleted, or it hasn't been shared with you."
            action={<Button asChild><Link href={back.href}>See your meal plans</Link></Button>}
          />
        ) : (
          <ErrorState title="Couldn't load this meal plan" onRetry={() => refetch()} />
        )}
      </div>
    );
  }

  const openEntry = plan.entries.find((e) => e.id === openEntryId && !hidden.has(e.id)) || null;
  const draggingEntry = plan.entries.find((e) => e.id === draggingId);
  const isEmpty = plan.entries.every((e) => hidden.has(e.id));
  const others = onlineUsers.filter((u) => u.userId !== user?.id);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title={plan.name}
        back={back}
        description={
          <>
            {formatPlanDates(plan.startDate, plan.endDate)}
            {others.length > 0 && <> · Also here now: {others.map((u) => u.displayName).join(", ")}</>}
          </>
        }
        primaryAction={
          <Button onClick={() => setGroceryOpen(true)} disabled={isEmpty} data-testid="button-generate-grocery">
            <ShoppingCart aria-hidden /> Make grocery list
          </Button>
        }
        secondaryActions={
          <>
            <MealPlanCollaborators planId={planId} isOwner={plan.ownerUserId === user?.id} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More for this meal plan">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11 text-base" onClick={() => setNutritionOpen(true)}>
                  <BarChart3 className="mr-2 h-4 w-4" aria-hidden /> Nutrition for the week
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11 text-base" onClick={() => setTemplateOpen(true)}>
                  <BookTemplate className="mr-2 h-4 w-4" aria-hidden /> Save as template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {isEmpty && (
        <p className="mb-4 rounded-lg border border-dashed p-4 text-base text-muted-foreground">
          Tap <span className="font-medium text-foreground">Add</span> under any meal to put a recipe or a note on that day.
          When the week looks right, choose <span className="font-medium text-foreground">Make grocery list</span>.
        </p>
      )}

      {/* Phone: one day after another (no sideways scrolling) */}
      <div className="space-y-6 md:hidden">
        {days.map((day) => {
          const dateKey = dateKeyOf(day);
          const isToday = dayLabel(day, { year: "numeric", month: "numeric", day: "numeric" }) === new Date().toLocaleDateString(undefined, { year: "numeric", month: "numeric", day: "numeric" });
          return (
            <section key={dateKey} aria-labelledby={`day-${dateKey}`} className="rounded-lg border bg-card">
              <h2 id={`day-${dateKey}`} className={`rounded-t-lg px-4 py-2 text-lg font-semibold ${isToday ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {dayLabel(day, { weekday: "long", month: "short", day: "numeric" })}
                {isToday && " · Today"}
              </h2>
              <div className="divide-y">
                {MEAL_SLOTS.map((slot) => {
                  const entries = entriesByCell.get(`${dateKey}|${slot}`) || [];
                  return (
                    <div key={slot} className="space-y-2 px-4 py-3">
                      <h3 className="text-sm font-semibold text-muted-foreground">{SLOT_LABELS[slot]}</h3>
                      {entries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setOpenEntryId(entry.id)}
                          className="flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-lg border bg-background text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {entry.recipe?.dishImageThumbnail ? (
                            <img src={entry.recipe.dishImageThumbnail} alt="" className="h-14 w-14 shrink-0 object-cover" />
                          ) : (
                            <span className="flex h-14 w-14 shrink-0 items-center justify-center bg-muted">
                              <Utensils className="h-5 w-5 text-muted-foreground" aria-hidden />
                            </span>
                          )}
                          <span className="min-w-0 flex-1"><EntryContent entry={entry} compact /></span>
                        </button>
                      ))}
                      <AddMenu
                        label={`Add to ${SLOT_LABELS[slot]}, ${dayLabel(day, { weekday: "long" })}`}
                        onRecipe={() => setPickerSlot({ date: dateKey, slot })}
                        onCustom={() => setCustomSlot({ date: dateKey, slot })}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Desktop: the week as a grid; drag meals between cells, or open one and use "Move to" */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className="hidden md:block">
          <div className="grid gap-1" style={{ gridTemplateColumns: `6rem repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((day) => (
              <div key={dateKeyOf(day)} className="rounded-t-lg bg-muted py-2 text-center">
                <div className="text-base font-semibold">{dayLabel(day, { weekday: "short" })}</div>
                <div className="text-sm text-muted-foreground">{dayLabel(day, { month: "short", day: "numeric" })}</div>
              </div>
            ))}
            {MEAL_SLOTS.map((slot) => (
              <div key={slot} className="contents">
                <div className="flex items-start justify-center rounded-l-lg bg-muted/50 px-2 pt-3 text-sm font-medium">{SLOT_LABELS[slot]}</div>
                {days.map((day) => {
                  const dateKey = dateKeyOf(day);
                  const cellKey = `${dateKey}|${slot}`;
                  return (
                    <DroppableCell key={cellKey} id={cellKey}>
                      <div className="space-y-1">
                        {(entriesByCell.get(cellKey) || []).map((entry) => (
                          <DraggableEntry key={entry.id} entry={entry} onOpen={() => setOpenEntryId(entry.id)} />
                        ))}
                        <AddMenu
                          label={`Add to ${SLOT_LABELS[slot]}, ${dayLabel(day, { weekday: "long" })}`}
                          onRecipe={() => setPickerSlot({ date: dateKey, slot })}
                          onCustom={() => setCustomSlot({ date: dateKey, slot })}
                          className="px-1"
                        />
                      </div>
                    </DroppableCell>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <DragOverlay>
          {draggingEntry && (
            <div className="max-w-40 rounded-md border bg-card p-2 text-sm font-medium shadow-lg">{entryTitle(draggingEntry)}</div>
          )}
        </DragOverlay>
      </DndContext>

      <EntryDialog
        entry={openEntry}
        days={days}
        assignable={assignable}
        onClose={() => setOpenEntryId(null)}
        onUpdate={(updates) => openEntry && updateEntry.mutate({ entryId: openEntry.id, updates })}
        onMove={(date, mealSlot) => {
          if (!openEntry) return;
          moveEntry.mutate({ entryId: openEntry.id, date, mealSlot });
          setOpenEntryId(null);
        }}
        onRemove={() => openEntry && removeEntry(openEntry)}
      />

      <RecipePicker
        open={!!pickerSlot}
        onOpenChange={(open) => { if (!open) setPickerSlot(null); }}
        onSelect={(recipeId, servings) => {
          if (pickerSlot) addEntry.mutate({ date: pickerSlot.date, mealSlot: pickerSlot.slot, recipeId, scaledServings: servings });
        }}
        mealSlot={pickerSlot?.slot}
        mealPlanId={planId}
      />

      <Dialog open={!!customSlot} onOpenChange={(open) => { if (!open) setCustomSlot(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
            <DialogDescription>For meals that aren't a recipe, like “Eating out” or “Pizza night”.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addCustom} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="custom-meal">Note</Label>
              <Input id="custom-meal" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Eating out with friends" className="h-11 text-base" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setCustomSlot(null)}>Cancel</Button>
              <Button type="submit" disabled={!customName.trim()}>Add note</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={groceryOpen} onOpenChange={setGroceryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make a grocery list for this week</DialogTitle>
            <DialogDescription>Adds the ingredients for every recipe in this plan. Meals marked as leftovers are skipped.</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="text-base font-medium">Where should they go?</legend>
            {([
              ["add_to_existing", "Add to my current grocery list"],
              ["create_new", "Start a new list (your current list is put away)"],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
                <input type="radio" name="grocery-mode" value={value} checked={groceryMode === value} onChange={() => setGroceryMode(value)} className="h-5 w-5 accent-[hsl(var(--primary))]" />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
            <input type="checkbox" checked={groceryExcludePantry} onChange={(e) => setGroceryExcludePantry(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" />
            Leave out things already in my pantry
          </label>
          {generateGrocery.isError && (
            <p role="alert" className="text-sm text-destructive">Couldn't make the list. Check your connection and try again.</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGroceryOpen(false)}>Cancel</Button>
            <Button onClick={() => generateGrocery.mutate()} disabled={generateGrocery.isPending}>
              {generateGrocery.isPending ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ShoppingCart aria-hidden />}
              Make grocery list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NutritionDashboard planId={planId} open={nutritionOpen} onOpenChange={setNutritionOpen} />

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>Reuse this week later: start a new plan from it under Templates.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (templateName.trim()) saveTemplate.mutate(); }}>
            <div className="space-y-1">
              <Label htmlFor="template-name">Template name</Label>
              <Input id="template-name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Busy weeknights" className="h-11 text-base" />
            </div>
            {saveTemplate.isError && (
              <p role="alert" className="text-sm text-destructive">Couldn't save the template. Check your connection and try again.</p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!templateName.trim() || saveTemplate.isPending}>
                {saveTemplate.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
                Save template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
