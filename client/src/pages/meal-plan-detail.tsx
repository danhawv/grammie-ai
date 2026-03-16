import { useState, useMemo } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  ShoppingCart,
  Loader2,
  Utensils,
  X,
  BarChart3,
  BookTemplate,
  Trash2,
  GripVertical,
  CalendarDays,
  Users,
  Clock,
  Recycle,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { RecipePicker } from "@/components/meal-plan/recipe-picker";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
const SLOT_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
const SLOT_ICONS: Record<string, string> = {
  breakfast: "\u2615",
  lunch: "\ud83c\udf5d",
  dinner: "\ud83c\udf7d\ufe0f",
  snack: "\ud83c\udf6a",
};

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

// Droppable cell component
function DroppableCell({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] p-1 rounded transition-colors ${
        isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""
      }`}
    >
      {children}
    </div>
  );
}

// Draggable entry card
function DraggableEntry({
  entry,
  onRemove,
  onAdjustServings,
}: {
  entry: MealPlanEntry;
  onRemove: () => void;
  onAdjustServings: (delta: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: entry.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const title = entry.recipe?.title || entry.customMealName || "Custom Meal";
  const servings = entry.scaledServings || entry.recipe?.servings || 1;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative bg-card border rounded-md p-2 text-xs shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-1">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing mt-0.5 text-muted-foreground"
        >
          <GripVertical className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate leading-tight" title={title}>
            {entry.isLeftover && (
              <Recycle className="h-3 w-3 inline mr-1 text-green-600" />
            )}
            {title}
          </div>
          {entry.recipe && (
            <div className="flex items-center gap-2 mt-0.5 text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <Users className="h-2.5 w-2.5" />
                {servings}
              </span>
              {entry.recipe.totalTime && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {entry.recipe.totalTime}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* Servings adjuster on hover */}
      {entry.recipe && (
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onAdjustServings(-1)}
            className="h-4 w-4 rounded bg-muted flex items-center justify-center hover:bg-muted-foreground/20"
          >
            <Minus className="h-2 w-2" />
          </button>
          <span className="text-[10px] w-12 text-center">
            {servings} serv.
          </span>
          <button
            onClick={() => onAdjustServings(1)}
            className="h-4 w-4 rounded bg-muted flex items-center justify-center hover:bg-muted-foreground/20"
          >
            <Plus className="h-2 w-2" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function MealPlanDetailPage() {
  const [, params] = useRoute("/meal-plans/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const planId = params?.id;

  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<{
    date: string;
    slot: string;
  } | null>(null);
  const [customMealDialog, setCustomMealDialog] = useState<{
    date: string;
    slot: string;
  } | null>(null);
  const [customMealName, setCustomMealName] = useState("");
  const [groceryDialog, setGroceryDialog] = useState(false);
  const [groceryExcludePantry, setGroceryExcludePantry] = useState(false);
  const [groceryMode, setGroceryMode] = useState<"create_new" | "add_to_existing">("create_new");
  const [nutritionDialog, setNutritionDialog] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const { data: plan, isLoading } = useQuery<MealPlanWithEntries>({
    queryKey: ["/api/meal-plans", planId],
    queryFn: async () => {
      const res = await fetch(`/api/meal-plans/${planId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!planId,
  });

  const { data: nutrition } = useQuery({
    queryKey: ["/api/meal-plans", planId, "nutrition"],
    queryFn: async () => {
      const res = await fetch(`/api/meal-plans/${planId}/nutrition`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!planId && nutritionDialog,
  });

  // Compute the days of the plan
  const days = useMemo(() => {
    if (!plan) return [];
    const start = new Date(plan.startDate);
    const end = new Date(plan.endDate);
    const result: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      result.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return result;
  }, [plan]);

  // Group entries by date-slot
  const entriesByCell = useMemo(() => {
    if (!plan) return new Map<string, MealPlanEntry[]>();
    const map = new Map<string, MealPlanEntry[]>();
    for (const entry of plan.entries) {
      const dateKey = new Date(entry.date).toISOString().split("T")[0];
      const cellKey = `${dateKey}|${entry.mealSlot}`;
      if (!map.has(cellKey)) map.set(cellKey, []);
      map.get(cellKey)!.push(entry);
    }
    return map;
  }, [plan]);

  // Mutations
  const addEntryMutation = useMutation({
    mutationFn: async ({
      date,
      mealSlot,
      recipeId,
      scaledServings,
      customMealName,
    }: {
      date: string;
      mealSlot: string;
      recipeId?: string;
      scaledServings?: number;
      customMealName?: string;
    }) => {
      const res = await fetch(`/api/meal-plans/${planId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, mealSlot, recipeId, scaledServings, customMealName }),
      });
      if (!res.ok) throw new Error("Failed to add entry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans", planId] });
    },
  });

  const removeEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await fetch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans", planId] });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({
      entryId,
      updates,
    }: {
      entryId: string;
      updates: any;
    }) => {
      const res = await fetch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans", planId] });
    },
  });

  const moveEntryMutation = useMutation({
    mutationFn: async ({
      entryId,
      date,
      mealSlot,
    }: {
      entryId: string;
      date: string;
      mealSlot: string;
    }) => {
      const res = await fetch(
        `/api/meal-plans/${planId}/entries/${entryId}/move`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, mealSlot, position: 0 }),
        }
      );
      if (!res.ok) throw new Error("Failed to move");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans", planId] });
    },
  });

  const generateGroceryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/meal-plans/${planId}/generate-grocery-list`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            excludeLeftovers: true,
            excludePantryItems: groceryExcludePantry,
            mode: groceryMode,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to generate");
      return res.json();
    },
    onSuccess: () => {
      setGroceryDialog(false);
      toast({ title: "Grocery list generated!" });
      navigate("/grocery-list");
    },
    onError: () => {
      toast({
        title: "Failed to generate grocery list",
        variant: "destructive",
      });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/meal-plans/${planId}/save-as-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateName }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      setTemplateDialog(false);
      setTemplateName("");
      toast({ title: "Saved as template!" });
    },
  });

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveEntryId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveEntryId(null);
    const { active, over } = event;
    if (!over || !active) return;

    const entryId = active.id as string;
    const dropId = over.id as string;

    // Parse drop target: "date|slot"
    const [date, mealSlot] = dropId.split("|");
    if (!date || !mealSlot) return;

    moveEntryMutation.mutate({ entryId, date, mealSlot });
  };

  const handleAddRecipe = (date: string, slot: string) => {
    setPickerSlot({ date, slot });
    setPickerOpen(true);
  };

  const handleRecipeSelected = (recipeId: string, servings: number) => {
    if (!pickerSlot) return;
    addEntryMutation.mutate({
      date: pickerSlot.date,
      mealSlot: pickerSlot.slot,
      recipeId,
      scaledServings: servings,
    });
  };

  const handleAddCustomMeal = () => {
    if (!customMealDialog || !customMealName.trim()) return;
    addEntryMutation.mutate({
      date: customMealDialog.date,
      mealSlot: customMealDialog.slot,
      customMealName: customMealName.trim(),
    });
    setCustomMealDialog(null);
    setCustomMealName("");
  };

  const handleAdjustServings = (entryId: string, delta: number, currentServings: number) => {
    const newServings = Math.max(1, currentServings + delta);
    updateEntryMutation.mutate({
      entryId,
      updates: { scaledServings: newServings },
    });
  };

  const activeEntry = plan?.entries.find((e) => e.id === activeEntryId);

  if (isLoading || !plan) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="container max-w-full mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/meal-plans">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-serif text-xl font-bold">{plan.name}</h1>
            <p className="text-xs text-muted-foreground">
              {new Date(plan.startDate).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
              })}{" "}
              –{" "}
              {new Date(plan.endDate).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNutritionDialog(true)}
          >
            <BarChart3 className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Nutrition</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplateDialog(true)}
          >
            <BookTemplate className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Save Template</span>
          </Button>
          <Button size="sm" onClick={() => setGroceryDialog(true)}>
            <ShoppingCart className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Grocery List</span>
          </Button>
        </div>
      </div>

      {/* Calendar Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            {/* Day headers */}
            <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 mb-1">
              <div /> {/* Empty corner */}
              {days.map((day, i) => {
                const isToday =
                  day.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={i}
                    className={`text-center py-2 text-sm font-medium rounded-t-lg ${
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <div>{dayLabels[i] || day.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div className="text-xs opacity-75">
                      {day.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Meal slot rows */}
            {MEAL_SLOTS.map((slot) => (
              <div
                key={slot}
                className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 mb-1"
              >
                {/* Slot label */}
                <div className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-muted/50 rounded-l-lg px-2">
                  <span className="mr-1">{SLOT_ICONS[slot]}</span>
                  {SLOT_LABELS[slot]}
                </div>

                {/* Day cells */}
                {days.map((day) => {
                  const dateKey = day.toISOString().split("T")[0];
                  const cellKey = `${dateKey}|${slot}`;
                  const cellEntries = entriesByCell.get(cellKey) || [];

                  return (
                    <DroppableCell key={cellKey} id={cellKey}>
                      <div className="space-y-1">
                        {cellEntries.map((entry) => (
                          <DraggableEntry
                            key={entry.id}
                            entry={entry}
                            onRemove={() =>
                              removeEntryMutation.mutate(entry.id)
                            }
                            onAdjustServings={(delta) =>
                              handleAdjustServings(
                                entry.id,
                                delta,
                                entry.scaledServings ||
                                  entry.recipe?.servings ||
                                  1
                              )
                            }
                          />
                        ))}
                        {/* Add buttons */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="w-full h-6 border border-dashed rounded text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center">
                              <Plus className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => handleAddRecipe(dateKey, slot)}
                            >
                              <Utensils className="h-4 w-4 mr-2" />
                              Add Recipe
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                setCustomMealDialog({
                                  date: dateKey,
                                  slot,
                                })
                              }
                            >
                              <PenLine className="h-4 w-4 mr-2" />
                              Custom Entry
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </DroppableCell>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeEntry && (
            <div className="bg-card border rounded-md p-2 text-xs shadow-lg opacity-90 max-w-[140px]">
              <div className="font-medium truncate">
                {activeEntry.recipe?.title || activeEntry.customMealName}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Recipe Picker */}
      <RecipePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleRecipeSelected}
        mealSlot={pickerSlot?.slot}
        mealPlanId={planId}
      />

      {/* Custom Meal Dialog */}
      <Dialog
        open={!!customMealDialog}
        onOpenChange={(open) => !open && setCustomMealDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Entry</DialogTitle>
            <DialogDescription>
              Add a note like "Eating out", "Leftovers", etc.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g., Eating out with friends"
            value={customMealName}
            onChange={(e) => setCustomMealName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddCustomMeal()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomMealDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleAddCustomMeal}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Grocery List Dialog */}
      <Dialog open={groceryDialog} onOpenChange={setGroceryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Generate Grocery List
            </DialogTitle>
            <DialogDescription>
              Create a consolidated grocery list from all recipes in this meal
              plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">List mode</Label>
              <div className="flex gap-2">
                <Button
                  variant={groceryMode === "create_new" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setGroceryMode("create_new")}
                >
                  Create New List
                </Button>
                <Button
                  variant={
                    groceryMode === "add_to_existing" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setGroceryMode("add_to_existing")}
                >
                  Add to Existing
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={groceryExcludePantry}
                onChange={(e) => setGroceryExcludePantry(e.target.checked)}
                className="rounded"
              />
              Exclude items I already have in my pantry
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGroceryDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => generateGroceryMutation.mutate()}
              disabled={generateGroceryMutation.isPending}
            >
              {generateGroceryMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ShoppingCart className="h-4 w-4 mr-2" />
              )}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nutrition Summary Dialog */}
      <Dialog open={nutritionDialog} onOpenChange={setNutritionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Nutrition Summary
            </DialogTitle>
          </DialogHeader>
          {nutrition ? (
            <div className="space-y-4">
              {/* Weekly Average */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Daily Average</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {[
                      { label: "Calories", value: nutrition.weeklyAverage.calories, unit: "kcal" },
                      { label: "Protein", value: nutrition.weeklyAverage.protein, unit: "g" },
                      { label: "Carbs", value: nutrition.weeklyAverage.carbs, unit: "g" },
                      { label: "Fat", value: nutrition.weeklyAverage.fat, unit: "g" },
                      { label: "Fiber", value: nutrition.weeklyAverage.fiber, unit: "g" },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <div className="text-lg font-bold">{stat.value || 0}</div>
                        <div className="text-xs text-muted-foreground">
                          {stat.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Budget Estimate */}
              {(nutrition.budgetEstimate.min > 0 || nutrition.budgetEstimate.max > 0) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Estimated Budget</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-semibold">
                      ${nutrition.budgetEstimate.min.toFixed(2)} – $
                      {nutrition.budgetEstimate.max.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      For the full week
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Daily Breakdown */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Daily Breakdown</h4>
                {Object.entries(nutrition.daily).map(
                  ([date, day]: [string, any]) => (
                    <div
                      key={date}
                      className="flex items-center justify-between text-sm border-b pb-1"
                    >
                      <span className="text-muted-foreground">
                        {new Date(date).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="flex gap-3 text-xs">
                        <span>{day.calories} cal</span>
                        <span>{day.protein}g P</span>
                        <span>{day.carbs}g C</span>
                        <span>{day.fat}g F</span>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Save as Template Dialog */}
      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Save this meal plan as a reusable template.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="template-name">Template Name</Label>
            <Input
              id="template-name"
              placeholder="e.g., Healthy Week Plan"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveTemplateMutation.mutate()}
              disabled={!templateName.trim() || saveTemplateMutation.isPending}
            >
              {saveTemplateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <BookTemplate className="h-4 w-4 mr-2" />
              )}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
