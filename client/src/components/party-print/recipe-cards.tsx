import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import QRCode from "qrcode";
import type { PartyDetail, PartyDish } from "@shared/party";
import { PER_SHEET, cardIngredients, cardSteps, fitPt, paginate, readCardRecipe, type CardRecipe, type StepsLength } from "@/lib/party-print";
import { publicUrl } from "@/lib/platform";
import { Sheet } from "./sheet";

// Take-home recipe cards: a 4x6 card per dish that has a recipe, two to a
// Letter page. The ingredients as written, the first steps, and a code that
// opens the whole recipe on a phone (/p/<invite>/dish/<dish>), no account needed.

export function recipeDishes(party: PartyDetail): PartyDish[] {
  return party.dishes.filter((d) => d.recipe);
}

export function RecipeCardSheets({ party, token, showCooks, steps, showScale }: {
  party: PartyDetail;
  token: string;
  showCooks: boolean;
  steps: StepsLength;
  showScale: boolean;
}) {
  const dishes = recipeDishes(party);
  // The full recipe (the party view only carries ingredients); a card still
  // prints from those if one can't be read
  const full = useQueries({
    queries: dishes.map((d) => ({
      queryKey: [`/api/party/${token}/dishes/${d.id}/recipe`],
      staleTime: 5 * 60 * 1000,
    })),
  });
  const sheets = paginate(dishes.map((d, i) => ({ dish: d, recipe: readCardRecipe(full[i]?.data) })), PER_SHEET["recipe-cards"]);

  return (
    <>
      {sheets.map((sheet, i) => (
        <Sheet key={i} label={`Recipe cards, page ${i + 1}`} className="flex flex-col items-center pt-[1.4in]">
          {sheet.map(({ dish, recipe }) => (
            <RecipeCard key={dish.id} party={party} dish={dish} recipe={recipe} token={token} showCook={showCooks} steps={steps} showScale={showScale} />
          ))}
        </Sheet>
      ))}
    </>
  );
}

function RecipeCard({ party, dish, recipe, token, showCook, steps, showScale }: {
  party: PartyDetail;
  dish: PartyDish;
  recipe: CardRecipe | null;
  token: string;
  showCook: boolean;
  steps: StepsLength;
  showScale: boolean;
}) {
  const qr = useQrCode(publicUrl(`/p/${encodeURIComponent(token)}/dish/${encodeURIComponent(dish.id)}`));
  const ing = cardIngredients(recipe?.ingredients.length ? recipe.ingredients : dish.recipe?.ingredients ?? []);
  const st = cardSteps(recipe?.steps ?? [], steps);
  const scaled = showScale && party.style === "dinner" && dish.scale !== 1 && dish.makeServings;

  return (
    <article className="pp-cut flex h-[4in] w-[6in] flex-col overflow-hidden px-[0.28in] py-[0.24in]" style={{ fontSize: "7.5pt", lineHeight: 1.3 }}>
      {/* A div, not <header>: the app's print CSS hides every header */}
      <div className="flex items-start gap-[0.15in]">
        <div className="min-w-0 flex-1">
          <h2 className="pp-title pp-clamp-2 leading-tight" style={{ fontSize: `${fitPt(dish.title, 17, 11, 30)}pt` }}>{dish.title}</h2>
          <p className="pp-clamp-1 mt-[0.03in] italic" style={{ fontSize: "8.5pt", color: "#57534e" }}>
            {showCook && dish.guestName ? `From ${dish.guestName}'s kitchen · ` : ""}{party.title}
          </p>
          {scaled && (
            <p className="mt-[0.02in]" style={{ fontSize: "7.5pt", color: "#57534e" }}>
              For the party: made {dish.scale}× to serve {dish.makeServings}. Amounts below are as written.
            </p>
          )}
        </div>
        <figure className="flex w-[0.85in] shrink-0 flex-col items-center">
          {qr ? <img src={qr} alt="Code that opens this recipe" className="h-[0.8in] w-[0.8in]" /> : <div className="h-[0.8in] w-[0.8in]" />}
          <figcaption className="mt-[0.02in] text-center leading-tight" style={{ fontSize: "5.5pt", color: "#78716c" }}>Scan for the full recipe</figcaption>
        </figure>
      </div>

      <div className="mt-[0.12in] grid min-h-0 flex-1 grid-cols-[2.15in_1fr] gap-[0.2in] border-t pt-[0.1in]" style={{ borderColor: "#d6d3d1" }}>
        <section className="min-h-0 overflow-hidden">
          <h3 className="pp-title mb-[0.04in] font-semibold" style={{ fontSize: "8.5pt" }}>Ingredients</h3>
          <ul>
            {ing.ingredients.map((line, i) => <li key={i} className="[overflow-wrap:anywhere]">{line}</li>)}
          </ul>
          {ing.more > 0 && <p className="mt-[0.03in] italic" style={{ color: "#57534e" }}>…and {ing.more} more on the full recipe</p>}
          {ing.ingredients.length === 0 && <p className="italic" style={{ color: "#57534e" }}>Scan the code for the ingredients.</p>}
        </section>
        <section className="min-h-0 overflow-hidden">
          {st.steps.length > 0 && (
            <>
              <h3 className="pp-title mb-[0.04in] font-semibold" style={{ fontSize: "8.5pt" }}>Steps</h3>
              <ol className="list-decimal pl-[0.16in]">
                {st.steps.map((s, i) => <li key={i} className="mb-[0.02in]">{s}</li>)}
              </ol>
            </>
          )}
          {(st.truncated || !recipe?.steps.length) && (
            <p className="mt-[0.04in] font-semibold italic" style={{ color: "#44403c" }}>Full recipe: scan the code</p>
          )}
        </section>
      </div>
    </article>
  );
}

/** The code as an SVG data URL, made on the device (nothing is sent anywhere) */
function useQrCode(text: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c1917", light: "#ffffff" } })
      .then((svg) => { if (live) setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [text]);
  return url;
}
