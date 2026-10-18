// Approving a prep plan puts it where the family already looks: the Kitchen
// calendar (meal_plans / meal_plan_entries) and the grocery list. The
// mapping is pure (tested); the writes are at the bottom.

import { and, eq } from "drizzle-orm";
import { groceryListItems, groceryLists, mealPlanEntries, mealPlans } from "@shared/schema";
import type { MealSlot, PrepPlan, PrepSetup, ShoppingList } from "@shared/meal-prep/contract";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO date a plan day is eaten on: the day after the session unless startSameDay */
export function eatingDate(setup: PrepSetup, day: number): string {
  const start = Date.parse(`${setup.session.date}T00:00:00Z`) + (setup.startSameDay ? 0 : DAY_MS);
  return new Date(start + day * DAY_MS).toISOString().slice(0, 10);
}

/** The calendar's meal slots (meal_plan_entries.meal_slot); it has no dessert */
export type CalendarSlot = Exclude<MealSlot, "dessert">;

export interface CalendarEntry {
  date: string;
  mealSlot: CalendarSlot;
  recipeId: string;
  /** whole servings across everyone eating it at that meal */
  scaledServings: number;
  notes: string;
}

/**
 * One calendar entry per dish per meal. Plates for several people at the
 * same meal share an entry; adjusters (plain rice, yogurt) stay off the
 * calendar since they aren't recipes. The calendar has no dessert slot, so
 * desserts go in as snacks with a "Dessert" note.
 */
export function calendarEntries(setup: PrepSetup, plan: PrepPlan): CalendarEntry[] {
  const names = new Map(setup.people.map(p => [p.id, p.name]));
  const byKey = new Map<string, { entry: CalendarEntry; servings: number; people: Set<string> }>();
  for (const plate of plan.plates) {
    for (const item of plate.items) {
      if (item.kind !== "recipe") continue;
      const key = `${plate.day}|${plate.slot}|${item.refId}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = {
          entry: {
            date: eatingDate(setup, plate.day),
            mealSlot: plate.slot === "dessert" ? "snack" : plate.slot,
            recipeId: item.refId,
            scaledServings: 1,
            notes: plate.slot === "dessert" ? "Dessert" : "",
          },
          servings: 0,
          people: new Set(),
        };
        byKey.set(key, agg);
      }
      agg.servings += item.amount;
      agg.people.add(names.get(plate.personId) ?? "Someone");
    }
  }
  return Array.from(byKey.values())
    .map(({ entry, servings, people }) => ({
      ...entry,
      scaledServings: Math.max(1, Math.round(servings)),
      notes: `${entry.notes ? `${entry.notes} · ` : ""}From meal prep · for ${Array.from(people).join(", ")}`,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.mealSlot.localeCompare(b.mealSlot));
}

export interface GroceryLine {
  item: string;
  displayName: string;
  quantity: number;
  unit: string;
  aisle: string;
  originalEntries: Array<{ recipeId: string; recipeTitle: string; quantity: number; unit: string; raw: string }>;
}

/**
 * Shopping list -> grocery list rows, skipping what's already on hand. One
 * provenance entry per row, so the grocery screen shows our amount as is.
 */
export function groceryLines(shopping: ShoppingList, titles: Record<string, string>): GroceryLine[] {
  const lines: GroceryLine[] = [];
  for (const group of shopping.byAisle) {
    for (const item of group.items) {
      if (item.have) continue;
      const grams = item.neededGrams != null ? Math.round(item.neededGrams) : null;
      const name = item.ingredient.name;
      const extra = grams == null ? item.display : item.buy;
      const recipeTitle = item.forRecipes.map(id => titles[id] ?? "").filter(Boolean).join(", ") || "Meal prep";
      // Bottled shakes are bought by the bottle, not the gram
      const counted = grams == null ? item.display.match(/^(\d+)\s+(bottles?)\b/) : null;
      const quantity = counted ? Number(counted[1]) : grams ?? 1;
      const unit = counted ? counted[2] : grams == null ? "" : "g";
      lines.push({
        item: name,
        displayName: extra ? `${name} (${extra})` : name,
        quantity,
        unit,
        aisle: group.aisle,
        originalEntries: [{ recipeId: item.forRecipes[0] ?? "", recipeTitle, quantity, unit, raw: item.display }],
      });
    }
  }
  return lines;
}

export function prepPlanName(setup: PrepSetup): string {
  const d = new Date(`${setup.session.date}T00:00:00Z`);
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Meal prep · ${label}`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface PrepIntegrations {
  /** creates a calendar meal plan with these entries; returns its id */
  pushToCalendar(ownerId: string, plan: { name: string; startDate: string; endDate: string; entries: CalendarEntry[] }): Promise<string>;
  /** adds rows to the active grocery list (or a new one); returns the list id */
  addToGroceryList(ownerId: string, list: { name: string; lines: GroceryLine[]; mode: "add_to_existing" | "create_new"; mealPlanId: string | null }): Promise<string>;
}

type Db = typeof import("../db").db;

export function createPgIntegrations(db: Db): PrepIntegrations {
  return {
    async pushToCalendar(ownerId, plan) {
      return db.transaction(async tx => {
        const [created] = await tx.insert(mealPlans).values({
          name: plan.name,
          description: "Made with meal prep",
          ownerUserId: ownerId,
          startDate: new Date(plan.startDate),
          endDate: new Date(plan.endDate),
          status: "active",
          isTemplate: false,
        }).returning();
        if (plan.entries.length > 0) {
          await tx.insert(mealPlanEntries).values(plan.entries.map((e, i) => ({
            mealPlanId: created.id,
            date: new Date(e.date),
            mealSlot: e.mealSlot,
            position: i,
            recipeId: e.recipeId,
            scaledServings: e.scaledServings,
            notes: e.notes,
            isLeftover: false,
          })));
        }
        return created.id;
      });
    },

    async addToGroceryList(ownerId, list) {
      return db.transaction(async tx => {
        let listId: string | null = null;
        if (list.mode === "add_to_existing") {
          const [active] = await tx.select().from(groceryLists)
            .where(and(eq(groceryLists.userId, ownerId), eq(groceryLists.status, "active")));
          listId = active?.id ?? null;
        } else {
          // Same as the calendar's "new list": the old one is archived, not deleted
          await tx.update(groceryLists).set({ status: "archived" })
            .where(and(eq(groceryLists.userId, ownerId), eq(groceryLists.status, "active")));
        }
        if (!listId) {
          const [created] = await tx.insert(groceryLists).values({ userId: ownerId, name: list.name, status: "active" }).returning();
          listId = created.id;
        }
        if (list.lines.length > 0) {
          await tx.insert(groceryListItems).values(list.lines.map(l => ({
            listId: listId!,
            item: l.item,
            quantity: l.quantity,
            unit: l.unit,
            displayName: l.displayName,
            aisle: l.aisle,
            checked: false,
            originalEntries: l.originalEntries,
          })));
        }
        if (list.mealPlanId) {
          await tx.update(mealPlans).set({ groceryListId: listId, updatedAt: new Date() }).where(eq(mealPlans.id, list.mealPlanId));
        }
        return listId;
      });
    },
  };
}
