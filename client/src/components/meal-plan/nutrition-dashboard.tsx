import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";

interface MealNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

interface DailyNutrition extends MealNutrition {
  mealBreakdown: {
    breakfast: MealNutrition;
    lunch: MealNutrition;
    dinner: MealNutrition;
    snack: MealNutrition;
  };
}

interface NutritionData {
  daily: Record<string, DailyNutrition>;
  weeklyAverage: MealNutrition;
  budgetEstimate?: { min: number; max: number };
}

interface NutritionDashboardProps {
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MEAL_COLORS = {
  breakfast: "#f59e0b",
  lunch: "#22c55e",
  dinner: "#3b82f6",
  snack: "#a855f7",
};

const MACRO_COLORS = {
  protein: "#3b82f6",
  carbs: "#f59e0b",
  fat: "#ef4444",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDayName(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[date.getDay()];
}

export default function NutritionDashboard({
  planId,
  open,
  onOpenChange,
}: NutritionDashboardProps) {
  const { data, isLoading } = useQuery<NutritionData>({
    queryKey: ["/api/meal-plans", planId, "nutrition"],
    queryFn: async () => {
      const res = await fetch(`/api/meal-plans/${planId}/nutrition`);
      if (!res.ok) throw new Error("Failed to fetch nutrition data");
      return res.json();
    },
    enabled: open,
  });

  const calorieChartData = data
    ? Object.entries(data.daily)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({
          day: getDayName(date),
          breakfast: day.mealBreakdown.breakfast.calories,
          lunch: day.mealBreakdown.lunch.calories,
          dinner: day.mealBreakdown.dinner.calories,
          snack: day.mealBreakdown.snack.calories,
        }))
    : [];

  const macroChartData = data
    ? [
        { name: "Protein", value: Math.round(data.weeklyAverage.protein), unit: "g" },
        { name: "Carbs", value: Math.round(data.weeklyAverage.carbs), unit: "g" },
        { name: "Fat", value: Math.round(data.weeklyAverage.fat), unit: "g" },
      ]
    : [];

  const macroColors = [MACRO_COLORS.protein, MACRO_COLORS.carbs, MACRO_COLORS.fat];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nutrition Dashboard</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="text-center py-8 text-muted-foreground">
            No nutrition data available.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Weekly Calorie Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Weekly Calories by Meal</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={calorieChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="breakfast" stackId="a" fill={MEAL_COLORS.breakfast} name="Breakfast" />
                    <Bar dataKey="lunch" stackId="a" fill={MEAL_COLORS.lunch} name="Lunch" />
                    <Bar dataKey="dinner" stackId="a" fill={MEAL_COLORS.dinner} name="Dinner" />
                    <Bar dataKey="snack" stackId="a" fill={MEAL_COLORS.snack} name="Snack" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Macro Donut Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Macro Breakdown (Daily Avg)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={macroChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}g`}
                      >
                        {macroChartData.map((_, index) => (
                          <Cell key={index} fill={macroColors[index]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `${value}g`} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Daily Average Summary */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Daily Averages</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <StatItem label="Calories" value={Math.round(data.weeklyAverage.calories)} unit="kcal" />
                    <StatItem label="Protein" value={Math.round(data.weeklyAverage.protein)} unit="g" />
                    <StatItem label="Carbs" value={Math.round(data.weeklyAverage.carbs)} unit="g" />
                    <StatItem label="Fat" value={Math.round(data.weeklyAverage.fat)} unit="g" />
                    <StatItem label="Fiber" value={Math.round(data.weeklyAverage.fiber)} unit="g" />
                    <StatItem label="Sodium" value={Math.round(data.weeklyAverage.sodium)} unit="mg" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Budget Estimate */}
            {data.budgetEstimate && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Estimated Weekly Budget</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">
                    ${data.budgetEstimate.min.toFixed(2)} &ndash; ${data.budgetEstimate.max.toFixed(2)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Based on average ingredient costs
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatItem({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">
        {value}
        <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>
      </p>
    </div>
  );
}
