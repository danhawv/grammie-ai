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
import { useMealPlanWebSocket } from "@/hooks/use-meal-plan-websocket";
import { useAuth } from "@/hooks/useAuth";
import NutritionDashboard from "@/components/meal-plan/nutrition-dashboard";
import { MealPlanCollaborators } from "@/components/meal-plan/collaborators";

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

// Format "40 mins" → "40m", "1 hour 40 mins" → "1h40m", "2 hours" → "2h"
function formatTime(timeStr: string): string {
  const lower = timeStr.toLowerCase().trim();
  let hours = 0;
  let mins = 0;
  const hMatch = lower.match(/(\d+)\s*h(?:ou)?r?s?/);
  const mMatch = lower.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);
  if (hMatch) hours = parseInt(hMatch[1]);
  if (mMatch) mins = parseInt(mMatch[1]);
  if (hours === 0 && mins === 0) {
    // Try plain number (assume minutes)
    const plain = lower.match(/^(\d+)$/);
    if (plain) mins = parseInt(plain[1]);
    else return timeStr;
  }
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
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
      className={`min-h-[60px] min-w-0 p-1 rounded transition-colors overflow-hidden ${
        isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""
      }`}
    >
      {children}
    </div>
  );
}

// Draggable entry card — image-forward, compact
function DraggableEntry({
  entry,
  onRemove,
  onToggleLeftover,
  collaborators,
  onAssign,
  onClick,
}: {
  entry: MealPlanEntry;
  onRemove: () => void;
  onToggleLeftover?: () => void;
  collaborators?: { userId: string; displayName: string }[];
  onAssign?: (userId: string | null) => void;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: entry.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const title = entry.recipe?.title || entry.customMealName || "Custom Meal";
  const servings = entry.scaledServings || entry.recipe?.servings || 1;
  const imageUrl =
    entry.recipe?.dishImageThumbnail || entry.recipe?.dishImage || null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative rounded-lg overflow-hidden max-w-full shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing bg-card border"
    >
      {/* Context menu — top-right corner on hover */}
      <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="bg-black/40 rounded p-0.5 hover:bg-black/60">
              <X className="h-3 w-3 text-white" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {onToggleLeftover && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onToggleLeftover(); }}>
                <Recycle className="h-3.5 w-3.5 mr-2" />
                {entry.isLeftover ? "Unmark Leftover" : "Mark as Leftover"}
              </DropdownMenuItem>
            )}
            {onAssign && collaborators && collaborators.length > 0 && (
              <>
                {collaborators.map((c) => (
                  <DropdownMenuItem
                    key={c.userId}
                    onClick={(e) => { e.stopPropagation(); onAssign(c.userId); }}
                  >
                    <Users className="h-3.5 w-3.5 mr-2" />
                    Assign to {c.displayName.split(" ")[0]}
                  </DropdownMenuItem>
                ))}
                {entry.assignedUser && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onAssign(null); }}>
                    <X className="h-3.5 w-3.5 mr-2" />
                    Unassign
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Leftover badge */}
      {entry.isLeftover && (
        <div className="absolute top-1 left-1 z-10 bg-green-600 text-white rounded px-1 py-0.5 text-[9px] font-medium flex items-center gap-0.5 group-hover:left-7">
          <Recycle className="h-2.5 w-2.5" /> Leftover
        </div>
      )}
      {/* Main clickable area */}
      <div onClick={onClick}>
        {/* Image */}
        {imageUrl ? (
          <div className="aspect-[4/3] w-full overflow-hidden">
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-[4/3] w-full bg-muted/50 flex items-center justify-center">
            <Utensils className="h-5 w-5 text-muted-foreground/40" />
          </div>
        )}
        {/* Info bar */}
        <div className="px-1.5 py-1">
          <div className="text-[10px] font-medium leading-tight truncate" title={title}>
            {title}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Users className="h-2 w-2" />
              {servings}
            </span>
            {entry.recipe?.totalTime && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2 w-2" />
                {formatTime(entry.recipe.totalTime)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Recipe sidebar panel
function RecipeSidebar({
  entry,
  onClose,
  onAdjustServings,
  onRemove,
}: {
  entry: MealPlanEntry;
  onClose: () => void;
  onAdjustServings: (delta: number) => void;
  onRemove: () => void;
}) {
  const recipe = entry.recipe;
  if (!recipe) return null;

  const servings = entry.scaledServings || recipe.servings || 1;
  const imageUrl = recipe.dishImage || recipe.dishImageThumbnail || null;

  return (
    <div className="fixed inset-y-0 right-0 w-80 md:w-96 bg-background border-l shadow-xl z-50 flex flex-col animate-in slide-in-from-right-full duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold text-sm truncate flex-1 mr-2">{recipe.title}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        {imageUrl && (
          <div className="aspect-video w-full overflow-hidden">
            <img src={imageUrl} alt={recipe.title} className="w-full h-full object-cover" />
          </div>
        )}
        {/* Quick stats */}
        <div className="flex items-center gap-3 p-4 border-b text-sm">
          {recipe.totalTime && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{formatTime(recipe.totalTime)}</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{servings} servings</span>
          </div>
        </div>
        {/* Servings adjuster */}
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-sm font-medium">Servings</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAdjustServings(-1)}
              className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="text-sm font-semibold w-6 text-center">{servings}</span>
            <button
              onClick={() => onAdjustServings(1)}
              className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
        {/* Description */}
        {recipe.description && (
          <div className="p-4 border-b">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</h4>
            <p className="text-sm text-muted-foreground">{recipe.description}</p>
          </div>
        )}
        {/* Ingredients */}
        {recipe.ingredients && recipe.ingredients.length > 0 && (
          <div className="p-4 border-b">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Ingredients</h4>
            <ul className="space-y-1">
              {recipe.ingredients.map((ing: any, i: number) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground mt-1.5 h-1.5 w-1.5 rounded-full bg-current flex-shrink-0" />
                  <span>
                    {ing.quantity && <span className="font-medium">{ing.quantity}</span>}
                    {ing.unit && <span> {ing.unit}</span>}
                    {" "}{ing.name || ing.item || ing}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Instructions */}
        {recipe.instructions && recipe.instructions.length > 0 && (
          <div className="p-4 border-b">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Instructions</h4>
            <ol className="space-y-2">
              {recipe.instructions.map((step: any, i: number) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="font-semibold text-muted-foreground text-xs mt-0.5 flex-shrink-0 w-5">{i + 1}.</span>
                  <span>{typeof step === "string" ? step : step.text || step.step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {/* Nutrition */}
        {(recipe.calories || recipe.protein || recipe.carbs || recipe.fat) && (
          <div className="p-4 border-b">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Nutrition (per serving)</h4>
            <div className="grid grid-cols-4 gap-2 text-center">
              {recipe.calories && (
                <div>
                  <div className="text-sm font-semibold">{recipe.calories}</div>
                  <div className="text-[10px] text-muted-foreground">cal</div>
                </div>
              )}
              {recipe.protein && (
                <div>
                  <div className="text-sm font-semibold">{recipe.protein}g</div>
                  <div className="text-[10px] text-muted-foreground">protein</div>
                </div>
              )}
              {recipe.carbs && (
                <div>
                  <div className="text-sm font-semibold">{recipe.carbs}g</div>
                  <div className="text-[10px] text-muted-foreground">carbs</div>
                </div>
              )}
              {recipe.fat && (
                <div>
                  <div className="text-sm font-semibold">{recipe.fat}g</div>
                  <div className="text-[10px] text-muted-foreground">fat</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Footer actions */}
      <div className="p-4 border-t flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" asChild>
          <Link href={`/recipes/${recipe.id}`}>View Full Recipe</Link>
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
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
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const { user } = useAuth();

  // Real-time collaboration via WebSocket
  const { onlineUsers } = useMealPlanWebSocket({
    planId: planId || "",
    userId: user?.id || "",
    enabled: !!planId && !!user?.id,
  });

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
    onMutate: async ({ entryId, date, mealSlot }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/meal-plans", planId] });
      // Snapshot previous value
      const previous = queryClient.getQueryData(["/api/meal-plans", planId]);
      // Optimistically update the entry's date and mealSlot
      queryClient.setQueryData(["/api/meal-plans", planId], (old: any) => {
        if (!old?.entries) return old;
        return {
          ...old,
          entries: old.entries.map((e: any) =>
            e.id === entryId ? { ...e, date, mealSlot, position: 0 } : e
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previous) {
        queryClient.setQueryData(["/api/meal-plans", planId], context.previous);
      }
    },
    onSettled: () => {
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

  const handleToggleLeftover = (entryId: string, currentValue: boolean) => {
    updateEntryMutation.mutate({
      entryId,
      updates: { isLeftover: !currentValue },
    });
  };

  const handleAssign = (entryId: string, userId: string | null) => {
    updateEntryMutation.mutate({
      entryId,
      updates: { assignedUserId: userId || undefined },
    });
  };

  // Build collaborator list for assignment dropdown
  const assignableUsers = useMemo(() => {
    if (!plan) return [];
    const users: { userId: string; displayName: string }[] = [];
    // Add owner
    if (user) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Me";
      users.push({ userId: user.id, displayName: name });
    }
    // Add collaborators
    if (plan.collaborators) {
      plan.collaborators.forEach((c: any) => {
        if (c.userId !== user?.id) {
          users.push({
            userId: c.userId,
            displayName: c.user?.displayName || c.user?.email || "Collaborator",
          });
        }
      });
    }
    return users;
  }, [plan, user]);

  const activeEntry = plan?.entries.find((e) => e.id === activeEntryId);
  const selectedEntry = plan?.entries.find((e) => e.id === selectedEntryId) || null;

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
      <div className="mb-4 space-y-2">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <Link href="/meal-plans">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="font-serif text-lg font-bold">{plan.name}</h1>
          <span className="text-sm text-muted-foreground">
            {new Date(plan.startDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}{" "}
            –{" "}
            {new Date(plan.endDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          {/* Online collaborators */}
          {onlineUsers.length > 1 && (
            <div className="flex -space-x-2 ml-2">
              {onlineUsers.slice(0, 5).map((u) => (
                <div
                  key={u.userId}
                  className="w-6 h-6 rounded-full bg-primary/10 border-2 border-background flex items-center justify-center text-[10px] font-medium"
                  title={u.displayName}
                >
                  {u.displayName.charAt(0).toUpperCase()}
                </div>
              ))}
              {onlineUsers.length > 5 && (
                <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px]">
                  +{onlineUsers.length - 5}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Action buttons row */}
        <div className="flex items-center gap-2 pl-10">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNutritionDialog(true)}
          >
            <BarChart3 className="h-4 w-4 mr-1" />
            Nutrition
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplateDialog(true)}
          >
            <BookTemplate className="h-4 w-4 mr-1" />
            Save Template
          </Button>
          <Button size="sm" onClick={() => setGroceryDialog(true)}>
            <ShoppingCart className="h-4 w-4 mr-1" />
            Grocery List
          </Button>
          <MealPlanCollaborators
            planId={planId!}
            isOwner={plan?.ownerUserId === user?.id}
          />
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
                            onToggleLeftover={() =>
                              handleToggleLeftover(entry.id, entry.isLeftover)
                            }
                            collaborators={assignableUsers}
                            onAssign={(userId) =>
                              handleAssign(entry.id, userId)
                            }
                            onClick={() => entry.recipe && setSelectedEntryId(entry.id)}
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

      {/* Nutrition Dashboard with Charts */}
      <NutritionDashboard
        planId={planId!}
        open={nutritionDialog}
        onOpenChange={setNutritionDialog}
      />

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

      {/* Recipe sidebar */}
      {selectedEntry && selectedEntry.recipe && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedEntryId(null)}
          />
          <RecipeSidebar
            entry={selectedEntry}
            onClose={() => setSelectedEntryId(null)}
            onAdjustServings={(delta) =>
              handleAdjustServings(
                selectedEntry.id,
                delta,
                selectedEntry.scaledServings ||
                  selectedEntry.recipe?.servings ||
                  1
              )
            }
            onRemove={() => {
              removeEntryMutation.mutate(selectedEntry.id);
              setSelectedEntryId(null);
            }}
          />
        </>
      )}
    </div>
  );
}
