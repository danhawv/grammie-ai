import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { CalendarDays, Package, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GroceryPanel } from "@/components/kitchen/grocery-panel";
import { PantryPanel } from "@/components/kitchen/pantry-panel";
import { MealPlansPanel } from "@/components/kitchen/meal-plans-panel";

// The Kitchen area (docs/DESIGN_PRINCIPLES.md §3): grocery list, pantry and
// meal plans as three tabs. The tab lives in the URL (/kitchen?tab=pantry) so
// links, Back and reloads land on the right one.

export type KitchenTab = "grocery" | "pantry" | "meal-plans";

const TABS: { value: KitchenTab; label: string; icon: typeof ShoppingCart }[] = [
  { value: "grocery", label: "Grocery list", icon: ShoppingCart },
  { value: "pantry", label: "Pantry", icon: Package },
  { value: "meal-plans", label: "Meal plans", icon: CalendarDays },
];

const ALIASES: Record<string, KitchenTab> = {
  grocery: "grocery", "grocery-list": "grocery", groceries: "grocery", list: "grocery",
  pantry: "pantry",
  "meal-plans": "meal-plans", meals: "meal-plans", "meal-plan": "meal-plans", plans: "meal-plans",
};

export function kitchenHref(tab: KitchenTab) {
  return `/kitchen?tab=${tab}`;
}

export default function KitchenPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab: KitchenTab = ALIASES[new URLSearchParams(search).get("tab") || ""] || "grocery";

  const setTab = (next: string) => navigate(kitchenHref(next as KitchenTab), { replace: true });

  useEffect(() => {
    document.title = `${TABS.find((t) => t.value === tab)?.label} · Kitchen · Grammie`;
  }, [tab]);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <PageHeader title="Kitchen" description="What to buy, what you have, and what you're cooking this week." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 grid h-auto w-full grid-cols-3 gap-1 p-1">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="min-h-11 flex-col gap-0.5 whitespace-normal px-1 text-sm sm:flex-row sm:gap-2 sm:text-base"
              data-testid={`kitchen-tab-${value}`}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="grocery" className="mt-0">
          <GroceryPanel onOpenPantry={() => setTab("pantry")} />
        </TabsContent>
        <TabsContent value="pantry" className="mt-0">
          <PantryPanel onOpenGrocery={() => setTab("grocery")} />
        </TabsContent>
        <TabsContent value="meal-plans" className="mt-0">
          <MealPlansPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
