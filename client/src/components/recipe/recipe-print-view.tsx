import type { Recipe } from "@shared/schema";
import { formatMinutes, ingredientDisplay } from "@shared/recipe-display";
import { isPlaceholderImage } from "./recipe-utils";

// Print-only layout (hidden on screen), used by "Print recipe".

export function RecipePrintView({ recipe, ingredients, instructions }: { recipe: Recipe; ingredients: any[]; instructions: any[] }) {
  const image = recipe.dishImage && !isPlaceholderImage(recipe.dishImage) ? recipe.dishImage : null;
  const info = [
    recipe.prepTimeMinutes ? `Prep: ${formatMinutes(recipe.prepTimeMinutes)}` : null,
    recipe.cookTimeMinutes ? `Cook: ${formatMinutes(recipe.cookTimeMinutes)}` : null,
    recipe.totalTimeMinutes ? `Total: ${formatMinutes(recipe.totalTimeMinutes)}` : null,
    recipe.servings ? `Serves: ${recipe.servings}` : null,
  ].filter(Boolean);

  return (
    <div className="hidden print:block print-recipe">
      <div className="print-recipe-header">
        <h1 className="print-recipe-title">{recipe.title}</h1>
        {recipe.description && <p className="print-recipe-description">{recipe.description}</p>}
      </div>

      <div className="print-recipe-images">
        {image && <img src={image} alt={recipe.title} className="print-recipe-dish-image" />}
        {recipe.handwrittenImage && (
          <img src={recipe.handwrittenImage} alt="Original handwritten recipe" className="print-recipe-handwritten-image" />
        )}
      </div>

      <div className="print-recipe-info">
        {info.map((t) => <span key={t}>{t}</span>)}
      </div>

      <div className="print-recipe-content">
        <div className="print-recipe-ingredients">
          <h2>Ingredients</h2>
          <ul>
            {ingredients.map((ing: any, idx: number) => {
              if (typeof ing === "string") return <li key={idx}>{ing}</li>;
              const d = ingredientDisplay(ing, "original");
              return (
                <li key={idx}>
                  {d.amount && `${d.amount} `}
                  {d.name}
                  {d.preparation && `, ${d.preparation}`}
                  {d.optional && " (optional)"}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="print-recipe-instructions">
          <h2>Instructions</h2>
          <ol>
            {instructions.map((step: any, idx: number) => (
              <li key={idx}>{typeof step === "string" ? step : step.text}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
