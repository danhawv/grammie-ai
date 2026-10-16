import type { ReactNode } from "react";
import type { PartyDetail, PartyDish } from "@shared/party";
import { PER_SHEET, containsLine, dietMarks, fitPt, paginate, type PlaceCard } from "@/lib/party-print";
import { Sheet } from "./sheet";

// Fold-over tent cards. Each card is cut out along the dashed line and
// folded on the dotted one; the top half is printed upside down so both
// sides read the right way up once it stands on the table.

/** A tent card: the same face on both halves, the top one turned over */
function Tent({ children, width, height }: { children: ReactNode; width: string; height: string }) {
  return (
    <div className="pp-cut relative" style={{ width, height }}>
      <div className="pp-flip absolute inset-x-0 top-0 flex h-1/2 flex-col items-center justify-center overflow-hidden px-[0.3in] text-center">{children}</div>
      <div className="absolute inset-x-0 bottom-0 flex h-1/2 flex-col items-center justify-center overflow-hidden px-[0.3in] text-center">{children}</div>
      <div aria-hidden className="pp-fold" />
    </div>
  );
}

// ---------------------------------------------------------------- place cards

/** Place cards: 2 x 3 per sheet, each 4in wide, 3.5in tall (1.75in folded) */
export function PlaceCardSheets({ cards }: { cards: PlaceCard[] }) {
  const sheets = paginate(cards, PER_SHEET["place-cards"]);
  return (
    <>
      {sheets.map((sheet, i) => (
        <Sheet key={i} label={`Place cards, page ${i + 1}`} className="grid content-start justify-center px-[0.25in] py-[0.25in]">
          <div className="grid grid-cols-[4in_4in] grid-rows-[3.5in_3.5in_3.5in]">
            {sheet.map((c) => (
              <Tent key={c.key} width="4in" height="3.5in">
                <PlaceFace card={c} />
              </Tent>
            ))}
          </div>
        </Sheet>
      ))}
    </>
  );
}

function PlaceFace({ card }: { card: PlaceCard }) {
  if (card.blank) return <div aria-hidden className="mt-[0.35in] h-px w-[2.6in]" style={{ background: "#d6d3d1" }} />;
  return (
    <>
      <p className="pp-title pp-clamp-2 leading-tight" style={{ fontSize: `${fitPt(card.name, 30, 15, 14)}pt` }}>{card.name}</p>
      {card.dish && (
        <p className="pp-clamp-1 mt-[0.06in] italic" style={{ fontSize: `${fitPt(card.dish, 10, 7.5, 40)}pt`, color: "#57534e" }}>
          bringing {card.dish}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- food labels

/** Food labels: 2 x 2 per sheet, each 4in wide, 5in tall (2.5in folded) */
export function FoodLabelSheets({ party, showCooks, showMarks }: { party: PartyDetail; showCooks: boolean; showMarks: boolean }) {
  const sheets = paginate(party.dishes, PER_SHEET["food-labels"]);
  return (
    <>
      {sheets.map((sheet, i) => (
        <Sheet key={i} label={`Food labels, page ${i + 1}`} className="grid content-start justify-center px-[0.25in] py-[0.5in]">
          <div className="grid grid-cols-[4in_4in] grid-rows-[5in_5in]">
            {sheet.map((dish) => (
              <Tent key={dish.id} width="4in" height="5in">
                <FoodFace dish={dish} showCook={showCooks} showMarks={showMarks} />
              </Tent>
            ))}
          </div>
        </Sheet>
      ))}
    </>
  );
}

const MARK_WORDS: Record<string, string> = { V: "Vegetarian", VG: "Vegan", GF: "Gluten-free", DF: "Dairy-free" };

function FoodFace({ dish, showCook, showMarks }: { dish: PartyDish; showCook: boolean; showMarks: boolean }) {
  const contains = containsLine(dish.recipe);
  const marks = showMarks ? dietMarks(dish.recipe) : [];
  return (
    <>
      <p className="pp-title pp-clamp-3 leading-tight" style={{ fontSize: `${fitPt(dish.title, 24, 13, 22)}pt` }}>{dish.title}</p>
      {showCook && dish.guestName && (
        <p className="pp-clamp-1 mt-[0.05in] italic" style={{ fontSize: "10.5pt", color: "#57534e" }}>Made by {dish.guestName}</p>
      )}
      {contains && (
        <p className="pp-clamp-2 mt-[0.1in] font-semibold" style={{ fontSize: `${contains.length > 48 ? 8.5 : 9.5}pt` }}>{contains}</p>
      )}
      {!dish.recipe && <p className="mt-[0.1in]" style={{ fontSize: "8.5pt", color: "#78716c" }}>Ask {dish.guestName || "the cook"} what's in it</p>}
      {marks.length > 0 && (
        <p className="mt-[0.08in] flex flex-wrap justify-center gap-[0.05in]">
          {marks.map((m) => (
            <span key={m} className="rounded-full px-[0.08in] py-[0.01in]" style={{ fontSize: "8pt", border: "0.75pt solid #78716c" }}>
              {MARK_WORDS[m]}
            </span>
          ))}
        </p>
      )}
    </>
  );
}
