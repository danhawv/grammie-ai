import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import type { PartyDetail, PartyDish, PartySlot } from "@shared/party";
import { Button } from "@/components/ui/button";
import { menuBoard } from "@/lib/party-format";
import { DishRow } from "./party-bits";

// Who's bringing what: each course with its places, claimed (dish, cook,
// conflicts) or open. Used by the host page and the guest page.

export function MenuBoard({
  party,
  onClaim,
  actionsFor,
  hrefFor,
}: {
  party: PartyDetail;
  /** "I'll bring this" on an open place; leave out to hide the button */
  onClaim?: (slot: PartySlot) => void;
  actionsFor?: (dish: PartyDish) => ReactNode;
  hrefFor?: (dish: PartyDish) => string | undefined;
}) {
  const groups = menuBoard(party.slots, party.dishes);
  if (groups.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">No courses on the menu yet.</p>;
  }
  const yours = (d: PartyDish) => !!party.youGuestId && d.guestId === party.youGuestId;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.course} aria-labelledby={`course-${g.course}`} className="space-y-3">
          <h3 id={`course-${g.course}`} className="font-serif text-xl font-semibold">{g.title}</h3>
          <ul className="space-y-3">
            {g.slots.map(({ slot, dish }) => (
              <li key={slot.id} className="rounded-lg border bg-card p-3">
                {slot.label && <p className="mb-2 text-sm font-medium text-muted-foreground">{slot.label}</p>}
                {dish ? (
                  <DishRow dish={dish} party={party} isYours={yours(dish)} actions={actionsFor?.(dish)} href={hrefFor?.(dish)} />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base text-muted-foreground">Open: nobody has picked this yet</p>
                    {onClaim && (
                      <Button variant="outline" onClick={() => onClaim(slot)}>
                        <Plus aria-hidden /> I'll bring this
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {g.extras.map((dish) => (
              <li key={dish.id} className="rounded-lg border bg-card p-3">
                <DishRow dish={dish} party={party} isYours={yours(dish)} actions={actionsFor?.(dish)} href={hrefFor?.(dish)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
