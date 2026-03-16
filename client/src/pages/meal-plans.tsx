import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import {
  CalendarDays,
  Plus,
  Archive,
  BookTemplate,
  Loader2,
  ArrowLeft,
  MoreVertical,
  Trash2,
  Copy,
  Users,
  ChefHat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

type MealPlan = {
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

export default function MealPlansPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<"active" | "archived" | "templates">("active");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanStartDate, setNewPlanStartDate] = useState(() => {
    // Default to Monday of current week
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split("T")[0];
  });

  const isTemplateTab = tab === "templates";

  const { data: plans = [], isLoading } = useQuery<MealPlan[]>({
    queryKey: ["/api/meal-plans", tab],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isTemplateTab) {
        params.set("includeTemplates", "true");
        params.set("status", "active");
      } else {
        params.set("status", tab);
      }
      const res = await fetch(`/api/meal-plans?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const filteredPlans = isTemplateTab
    ? plans.filter((p) => p.isTemplate)
    : plans.filter((p) => !p.isTemplate);

  const createMutation = useMutation({
    mutationFn: async () => {
      const startDate = new Date(newPlanStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6); // 7-day plan

      const res = await fetch("/api/meal-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPlanName || `Week of ${startDate.toLocaleDateString()}`,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: (plan: MealPlan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      setShowCreateDialog(false);
      setNewPlanName("");
      navigate(`/meal-plans/${plan.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create meal plan", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/meal-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      toast({ title: "Meal plan deleted" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/meal-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("Failed to archive");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plans"] });
      toast({ title: "Meal plan archived" });
    },
  });

  const formatDateRange = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
  };

  return (
    <div className="container max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-serif text-2xl font-bold">Meal Plans</h1>
            <p className="text-sm text-muted-foreground">
              Plan your meals for the week
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Plan
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["active", "archived", "templates"] as const).map((t) => (
          <Button
            key={t}
            variant={tab === t ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t)}
          >
            {t === "active" && <CalendarDays className="h-4 w-4 mr-1" />}
            {t === "archived" && <Archive className="h-4 w-4 mr-1" />}
            {t === "templates" && <BookTemplate className="h-4 w-4 mr-1" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Button>
        ))}
      </div>

      {/* Plans List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredPlans.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {isTemplateTab
                ? "No templates yet"
                : tab === "archived"
                ? "No archived plans"
                : "No meal plans yet"}
            </h3>
            <p className="text-muted-foreground mb-4 max-w-sm">
              {isTemplateTab
                ? "Save a meal plan as a template to reuse it later."
                : "Create your first meal plan to start organizing your weekly meals."}
            </p>
            {!isTemplateTab && tab === "active" && (
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Meal Plan
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredPlans.map((plan) => (
            <Card
              key={plan.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/meal-plans/${plan.id}`)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {formatDateRange(plan.startDate, plan.endDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {plan.isTemplate && (
                    <Badge variant="secondary">
                      <BookTemplate className="h-3 w-3 mr-1" />
                      Template
                    </Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!plan.isTemplate && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveMutation.mutate(plan.id);
                          }}
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(plan.id);
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              {plan.description && (
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {plan.description}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Meal Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="plan-name">Plan Name (optional)</Label>
              <Input
                id="plan-name"
                placeholder="e.g., Family Dinners This Week"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-date">Week Starting</Label>
              <Input
                id="start-date"
                type="date"
                value={newPlanStartDate}
                onChange={(e) => setNewPlanStartDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
