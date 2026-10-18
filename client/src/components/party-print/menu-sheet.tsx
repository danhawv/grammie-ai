import { menuSections, type PartyDetail } from "@shared/party";
import { dietMarks, fitPt, marksKey, menuDensity, partyDateLine } from "@/lib/party-print";
import { Sheet } from "./sheet";

// The menu: one elegant page with every course, each dish and (if wanted)
// who made it and small diet marks with a key at the foot.

export function MenuSheet({ party, showCooks, showMarks }: { party: PartyDetail; showCooks: boolean; showMarks: boolean }) {
  const sections = menuSections(party.dishes);
  const d = menuDensity(sections.length, party.dishes.length);
  const marks = party.dishes.map((dish) => (showMarks ? dietMarks(dish.recipe) : []));
  const markOf = new Map(party.dishes.map((dish, i) => [dish.id, marks[i]]));
  const key = marksKey(marks);
  const date = partyDateLine(party.startsAt);
  const pt = (n: number) => `${Math.round(n * d * 10) / 10}pt`;

  return (
    <Sheet label="Menu" flow className="flex flex-col px-[0.9in] py-[0.8in] text-center [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
      {/* A div, not <header>: the app's print CSS hides every header */}
      <div style={{ marginBottom: `${0.45 * d}in` }}>
        <p className="pp-title" style={{ fontSize: pt(13), letterSpacing: "0.3em", textTransform: "uppercase", color: "#78716c" }}>Menu</p>
        <h1 className="pp-title pp-clamp-2 mt-2 leading-tight" style={{ fontSize: `${fitPt(party.title, 34, 20, 22) * d}pt` }}>{party.title}</h1>
        {date && <p className="mt-2 italic" style={{ fontSize: pt(12), color: "#57534e" }}>{date}</p>}
        <Rule />
      </div>

      <div className="flex-1">
        {sections.map((s) => (
          <section key={s.course} className="break-inside-avoid" style={{ marginBottom: `${0.32 * d}in` }}>
            <h2 className="pp-title" style={{ fontSize: pt(14), letterSpacing: "0.18em", textTransform: "uppercase", color: "#78716c", marginBottom: `${0.1 * d}in` }}>
              {s.title}
            </h2>
            <ul>
              {s.dishes.map((dish) => (
                <li key={dish.id} style={{ marginBottom: `${0.09 * d}in` }}>
                  <span className="pp-clamp-2" style={{ fontSize: `${fitPt(dish.title, 15, 11.5, 56) * d}pt`, lineHeight: 1.25 }}>
                    {dish.title}
                    {(markOf.get(dish.id) ?? []).length > 0 && (
                      <span style={{ fontSize: pt(8), letterSpacing: "0.06em", color: "#78716c", marginLeft: "0.5em", verticalAlign: "0.2em" }}>
                        {(markOf.get(dish.id) ?? []).join(" · ")}
                      </span>
                    )}
                  </span>
                  {showCooks && dish.guestName && (
                    <span className="block italic" style={{ fontSize: pt(10.5), color: "#57534e" }}>by {dish.guestName}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {key.length > 0 && (
        <footer className="break-inside-avoid" style={{ fontSize: pt(8.5), color: "#78716c", marginTop: `${0.2 * d}in` }}>
          <Rule />
          {key.map((k) => `${k.mark} ${k.label.toLowerCase()}`).join("   ·   ")}
        </footer>
      )}
    </Sheet>
  );
}

function Rule() {
  return <div aria-hidden className="mx-auto my-[0.18in] h-px w-[1.6in]" style={{ background: "#a8a29e" }} />;
}
