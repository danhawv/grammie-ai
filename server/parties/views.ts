// What the party API sends: rows from store.ts turned into the shapes in
// shared/party.ts. Dish scale and conflicts are worked out here, with the
// same rules the screens use. Allergy and diet details of other guests are
// sent to the host only; everyone else sees the conflicts on each dish.

import {
  dishConflicts, dishScale,
  type Allergen, type DishRecipeFacts, type PartyDetail, type PartyDiet, type PartyDish, type PartyGuest,
  type PartySlot, type PartySummary,
} from "@shared/party";
import type { PartyDishRow, PartyGuestRow, PartyRow, PartySlotRow, PartyUser, RecipeFactsRow } from "./store";

export function toFacts(r: RecipeFactsRow): DishRecipeFacts {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    image: r.image,
    servings: r.servings,
    allergens: r.allergens,
    diets: r.diets,
    ingredients: r.ingredients,
    status: r.status,
  };
}

export function toSlot(s: PartySlotRow): PartySlot {
  return { id: s.id, course: s.course, label: s.label, position: s.position };
}

/** All of a guest's facts (the host's view, and conflict checks) */
function fullGuest(g: PartyGuestRow, users: Map<string, PartyUser>): PartyGuest {
  return {
    id: g.id,
    name: g.name,
    rsvp: g.rsvp,
    partySize: g.partySize,
    allergies: (g.allergies ?? []) as Allergen[],
    diets: (g.diets ?? []) as PartyDiet[],
    dietNote: g.dietNote,
    isHost: g.isHost,
    hasAccount: !(users.get(g.userId)?.isGuest ?? false),
  };
}

export function toDish(
  d: PartyDishRow,
  party: Pick<PartyRow, "style" | "headcount">,
  guestName: string,
  facts: RecipeFactsRow | null,
  guests: PartyGuest[],
): PartyDish {
  const recipe = facts ? toFacts(facts) : null;
  const { scale, makeServings } = dishScale(party.style, recipe?.servings, party.headcount);
  return {
    id: d.id,
    slotId: d.slotId,
    course: d.course,
    guestId: d.guestId,
    guestName,
    // Blank means "use the recipe's title", which an import fills in later
    title: d.title || recipe?.title || "A dish",
    note: d.note,
    recipe,
    makeServings,
    scale,
    conflicts: dishConflicts(recipe, guests),
    createdAt: d.createdAt.toISOString(),
  };
}

export interface DetailInput {
  party: PartyRow;
  slots: PartySlotRow[];
  guests: PartyGuestRow[];
  dishes: PartyDishRow[];
  facts: RecipeFactsRow[];
  users: PartyUser[];
  role: PartyDetail["role"];
  viewerGuestId: string | null;
  inviteUrl: string | null;
  credits: number | null;
}

export function toPartyDetail(input: DetailInput): PartyDetail {
  const { party, role, viewerGuestId } = input;
  const users = new Map(input.users.map((u) => [u.id, u]));
  const facts = new Map(input.facts.map((f) => [f.id, f]));
  const everyone = input.guests.map((g) => fullGuest(g, users));
  const names = new Map(everyone.map((g) => [g.id, g.name]));
  const host = everyone.find((g) => g.isHost);

  const guests: PartyGuest[] = everyone.map((g) => {
    const you = g.id === viewerGuestId;
    if (role === "host" || you) return you ? { ...g, isYou: true } : g;
    return { ...g, allergies: [], diets: [], dietNote: null };
  });

  return {
    id: party.id,
    title: party.title,
    style: party.style,
    startsAt: party.startsAt ? party.startsAt.toISOString() : null,
    location: party.location,
    theme: party.theme,
    hostNote: party.hostNote,
    headcount: party.headcount,
    externalInviteUrl: party.externalInviteUrl,
    coverImage: party.coverImage,
    cookbookId: party.cookbookId,
    hostName: host?.name ?? "The host",
    role,
    inviteUrl: input.inviteUrl,
    slots: input.slots.map(toSlot),
    guests,
    dishes: input.dishes.map((d) => toDish(
      d, party, names.get(d.guestId) ?? "A guest", d.recipeId ? facts.get(d.recipeId) ?? null : null, everyone,
    )),
    confirmedPeople: everyone.filter((g) => g.rsvp === "yes").reduce((n, g) => n + Math.max(1, g.partySize), 0),
    youGuestId: viewerGuestId,
    credits: input.credits,
  };
}

export function toSummary(entry: { party: PartyRow; isHost: boolean; dishCount: number; guestCount: number }): PartySummary {
  const p = entry.party;
  return {
    id: p.id,
    title: p.title,
    style: p.style,
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    location: p.location,
    role: entry.isHost ? "host" : "guest",
    dishCount: entry.dishCount,
    guestCount: entry.guestCount,
    coverImage: p.coverImage,
  };
}

/** Upcoming parties first (soonest first), then undated, then past ones (latest first) */
export function sortSummaries(list: PartySummary[], now: Date): PartySummary[] {
  const t = (s: PartySummary) => (s.startsAt ? Date.parse(s.startsAt) : NaN);
  const rank = (s: PartySummary) => (Number.isNaN(t(s)) ? 1 : t(s) >= now.getTime() - 12 * 3600_000 ? 0 : 2);
  return [...list].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return t(a) - t(b);
    if (ra === 2) return t(b) - t(a);
    return 0;
  });
}
