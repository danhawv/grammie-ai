import type { Recipe } from "@shared/schema";
import {
  AlertTriangle,
  Beer,
  BookOpen,
  ChevronDown,
  ChefHat,
  Coffee,
  DollarSign,
  Drumstick,
  Flame,
  Heart,
  Info,
  Lightbulb,
  Loader2,
  Martini,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Utensils,
  Wine,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Everything beyond the recipe itself, in one collapsed "More from Grammie"
// section below the steps and notes (docs/DESIGN_PRINCIPLES.md rule 1).
// The section contents are unchanged from the previous page; they were only
// moved here.

function getDietaryFlags(recipe: Recipe): string[] {
  const flags: string[] = [];
  if (recipe.isVegetarian) flags.push("Vegetarian");
  if (recipe.isVegan) flags.push("Vegan");
  if (recipe.isPescatarian) flags.push("Pescatarian");
  if (recipe.isGlutenFree) flags.push("Gluten-Free");
  if (recipe.isDairyFree) flags.push("Dairy-Free");
  if (recipe.isKeto) flags.push("Keto");
  if (recipe.isPaleo) flags.push("Paleo");
  if (recipe.isLowCarb) flags.push("Low-Carb");
  if (recipe.isHighProtein) flags.push("High-Protein");
  if (recipe.isLowCalorie) flags.push("Low-Calorie");
  if (recipe.isHighFiber) flags.push("High-Fiber");
  if (recipe.isLactoVegetarian) flags.push("Lacto-Vegetarian");
  if (recipe.isMediterranean) flags.push("Mediterranean");
  if (recipe.isOvoVegetarian) flags.push("Ovo-Vegetarian");
  if (recipe.isOvoLactoVegetarian) flags.push("Ovo-Lacto-Vegetarian");
  if (recipe.isFlexitarian) flags.push("Flexitarian");
  if (recipe.isCarnivore) flags.push("Carnivore");
  if (recipe.isKosher) flags.push("Kosher");
  if (recipe.isHalal) flags.push("Halal");
  if (recipe.isHindu) flags.push("Hindu");
  return flags;
}

/** The extra sections, without the outer collapsible (rendered by RecipeExtras) */
function ExtrasContent({ recipe }: { recipe: Recipe }) {
  const activeDietaryFlags = getDietaryFlags(recipe);

  const nutritionQualityTags: string[] = [];
  if (recipe.isLowFat) nutritionQualityTags.push("Low-Fat");
  if (recipe.isLowSodium) nutritionQualityTags.push("Low-Sodium");
  if (recipe.isLowSugar) nutritionQualityTags.push("Low-Sugar");

  const tipsByType = recipe.tips?.reduce((acc: any, tip: any) => {
    if (!acc[tip.type]) acc[tip.type] = [];
    acc[tip.type].push(tip);
    return acc;
  }, {} as Record<string, any>);

  const variationsByType = recipe.variations?.reduce((acc: any, variation: any) => {
    if (!acc[variation.type]) acc[variation.type] = [];
    acc[variation.type].push(variation);
    return acc;
  }, {} as Record<string, any>);

  return (
    <div className="space-y-6">
      {/* Recipe Details Card */}
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="font-serif text-xl">
            Recipe Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {((recipe.cuisines && recipe.cuisines.length > 0) || recipe.cuisine) && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                {recipe.cuisines && recipe.cuisines.length > 1 ? "Cuisines" : "Cuisine"}
              </div>
              <div className="flex flex-wrap gap-2">
                {recipe.cuisines && recipe.cuisines.length > 0 ? (
                  (recipe.cuisines ?? []).map((cuisine: string) => (
                    <Badge key={cuisine} variant="secondary" data-testid={`badge-cuisine-${cuisine}`}>
                      {cuisine}
                    </Badge>
                  ))
                ) : recipe.cuisine ? (
                  <Badge variant="secondary" data-testid="badge-cuisine">
                    {recipe.cuisine}
                  </Badge>
                ) : null}
              </div>
            </div>
          )}

          {recipe.occasionTags && recipe.occasionTags.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                Occasions
              </div>
              <div className="flex flex-wrap gap-2">
                {(recipe.occasionTags ?? []).map((tag: string) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    data-testid={`badge-occasion-${tag}`}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {recipe.cookingMethods && recipe.cookingMethods.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                Cooking Methods
              </div>
              <div className="flex flex-wrap gap-2">
                {(recipe.cookingMethods ?? []).map((method: string) => (
                  <Badge
                    key={method}
                    variant="outline"
                    data-testid={`badge-method-${method}`}
                  >
                    {method}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {recipe.seasonTags && recipe.seasonTags.length > 0 && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                Seasonal
              </div>
              <div className="flex flex-wrap gap-2">
                {(recipe.seasonTags ?? []).map((season: string) => (
                  <Badge
                    key={season}
                    variant="secondary"
                    data-testid={`badge-season-${season}`}
                  >
                    {season}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {(recipe.totalCost != null || recipe.costExcludingStaples != null || recipe.priceRangeMin != null || recipe.priceRangeMax != null || recipe.priceCategory) && (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                Estimated Cost
              </div>
              <div className="space-y-2">
                {recipe.totalCost != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Total Recipe Cost:</span>
                    <Badge variant="outline" data-testid="badge-total-cost">
                      ${recipe.totalCost.toFixed(2)}
                    </Badge>
                  </div>
                )}
                {recipe.costExcludingStaples != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Cost (excluding staples):</span>
                    <Badge variant="outline" data-testid="badge-cost-excluding-staples">
                      ${recipe.costExcludingStaples.toFixed(2)}
                    </Badge>
                  </div>
                )}
                {recipe.priceRangeMin != null && recipe.priceRangeMax != null && recipe.priceRangeMin !== recipe.priceRangeMax && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Per Serving:</span>
                    <Badge variant="outline" data-testid="badge-price-range">
                      ${recipe.priceRangeMin.toFixed(2)} - ${recipe.priceRangeMax.toFixed(2)}
                    </Badge>
                  </div>
                )}
                {recipe.priceCategory && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Category:</span>
                    <Badge variant="secondary" data-testid="badge-price-category">
                      {recipe.priceCategory}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          )}

          {recipe.skillLevel && (
            <div>
              <div className="flex items-center gap-3">
                <ChefHat className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <div className="text-sm text-muted-foreground">
                    Skill Level
                  </div>
                  <div
                    className="font-medium"
                    data-testid="text-skill-level"
                  >
                    {recipe.skillLevel}
                  </div>
                  {recipe.skillLevelExplanation && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {recipe.skillLevelExplanation}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

        {/* Content enrichment loading skeleton — shown while Group 3 content loads in background */}
        {recipe.contentEnrichmentStatus === 'enriching' && !recipe.beveragePairings && !recipe.culturalSignificance && !recipe.celebrityChefReviews && (
          <Card className="border-dashed">
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-lg flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading additional content...
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <p className="text-xs text-muted-foreground mt-2">
                Chef reviews, beverage pairings, and cultural context are being generated...
              </p>
            </CardContent>
          </Card>
        )}

        {recipe.beveragePairings && (
          (recipe.beveragePairings.wines?.length > 0 ||
           recipe.beveragePairings.beers?.length > 0 ||
           recipe.beveragePairings.cocktails?.length > 0 ||
           recipe.beveragePairings.nonAlcoholic?.length > 0) && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl">
                Beverage Pairings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                {recipe.beveragePairings.wines && recipe.beveragePairings.wines.length > 0 && (
                  <AccordionItem value="wines" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-wines">
                      <div className="flex items-center gap-2">
                        <Wine className="h-4 w-4 text-primary" />
                        <span>Wine Pairings ({recipe.beveragePairings.wines.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.beveragePairings.wines ?? []).map((pairing: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-wine-${idx}`}>
                            <div className="font-semibold">{pairing.name}</div>
                            {pairing.styleOrVarietal && (
                              <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                            )}
                            {pairing.tastingNotes && (
                              <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                            )}
                            <div className="text-sm mt-1">{pairing.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.beveragePairings.beers && recipe.beveragePairings.beers.length > 0 && (
                  <AccordionItem value="beers" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-beers">
                      <div className="flex items-center gap-2">
                        <Beer className="h-4 w-4 text-primary" />
                        <span>Beer Pairings ({recipe.beveragePairings.beers.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.beveragePairings.beers ?? []).map((pairing: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-beer-${idx}`}>
                            <div className="font-semibold">{pairing.name}</div>
                            {pairing.styleOrVarietal && (
                              <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                            )}
                            {pairing.tastingNotes && (
                              <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                            )}
                            <div className="text-sm mt-1">{pairing.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.beveragePairings.cocktails && recipe.beveragePairings.cocktails.length > 0 && (
                  <AccordionItem value="cocktails" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-cocktails">
                      <div className="flex items-center gap-2">
                        <Martini className="h-4 w-4 text-primary" />
                        <span>Cocktail Pairings ({recipe.beveragePairings.cocktails.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.beveragePairings.cocktails ?? []).map((pairing: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-cocktail-${idx}`}>
                            <div className="font-semibold">{pairing.name}</div>
                            {pairing.styleOrVarietal && (
                              <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                            )}
                            {pairing.tastingNotes && (
                              <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                            )}
                            <div className="text-sm mt-1">{pairing.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.beveragePairings.nonAlcoholic && recipe.beveragePairings.nonAlcoholic.length > 0 && (
                  <AccordionItem value="non-alcoholic" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-non-alcoholic">
                      <div className="flex items-center gap-2">
                        <Coffee className="h-4 w-4 text-primary" />
                        <span>Non-Alcoholic Pairings ({recipe.beveragePairings.nonAlcoholic.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.beveragePairings.nonAlcoholic ?? []).map((pairing: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-non-alcoholic-${idx}`}>
                            <div className="font-semibold">{pairing.name}</div>
                            {pairing.styleOrVarietal && (
                              <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                            )}
                            {pairing.tastingNotes && (
                              <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                            )}
                            <div className="text-sm mt-1">{pairing.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            </CardContent>
          </Card>
          )
        )}

        {recipe.recipeVariations && (
          (recipe.recipeVariations.lowerCalorie?.length > 0 ||
           recipe.recipeVariations.higherProtein?.length > 0 ||
           recipe.recipeVariations.michelinUpgrade?.length > 0 ||
           recipe.recipeVariations.budgetFriendly?.length > 0) && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl">
                Recipe Variations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                {recipe.recipeVariations.lowerCalorie && recipe.recipeVariations.lowerCalorie.length > 0 && (
                  <AccordionItem value="lower-calorie" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-lower-calorie">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-green-600" />
                        <span>Lower Calorie Options ({recipe.recipeVariations.lowerCalorie.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.recipeVariations.lowerCalorie ?? []).map((swap: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-green-600 pl-3" data-testid={`variation-lower-calorie-${idx}`}>
                            <div className="font-semibold">Replace: {swap.targetIngredient}</div>
                            <div className="text-sm">With: {swap.replacement}</div>
                            <div className="text-sm text-muted-foreground mt-1">{swap.reason}</div>
                            <div className="text-sm text-green-600 font-medium mt-1">{swap.impactSummary}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.recipeVariations.higherProtein && recipe.recipeVariations.higherProtein.length > 0 && (
                  <AccordionItem value="higher-protein" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-higher-protein">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-blue-600" />
                        <span>Higher Protein Options ({recipe.recipeVariations.higherProtein.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.recipeVariations.higherProtein ?? []).map((swap: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-blue-600 pl-3" data-testid={`variation-higher-protein-${idx}`}>
                            <div className="font-semibold">Replace: {swap.targetIngredient}</div>
                            <div className="text-sm">With: {swap.replacement}</div>
                            <div className="text-sm text-muted-foreground mt-1">{swap.reason}</div>
                            <div className="text-sm text-blue-600 font-medium mt-1">{swap.impactSummary}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.recipeVariations.michelinUpgrade && recipe.recipeVariations.michelinUpgrade.length > 0 && (
                  <AccordionItem value="michelin-upgrade" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-michelin-upgrade">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-yellow-600" />
                        <span>Michelin-Star Upgrades ({recipe.recipeVariations.michelinUpgrade.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.recipeVariations.michelinUpgrade ?? []).map((enhancement: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-yellow-600 pl-3" data-testid={`variation-michelin-${idx}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs">{enhancement.focus}</Badge>
                            </div>
                            <div className="font-semibold">{enhancement.recommendation}</div>
                            <div className="text-sm text-muted-foreground mt-1">{enhancement.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.recipeVariations.budgetFriendly && recipe.recipeVariations.budgetFriendly.length > 0 && (
                  <AccordionItem value="budget-friendly" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-budget-friendly">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-purple-600" />
                        <span>Budget-Friendly Options ({recipe.recipeVariations.budgetFriendly.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {(recipe.recipeVariations.budgetFriendly ?? []).map((swap: any, idx: number) => (
                          <div key={idx} className="border-l-2 border-purple-600 pl-3" data-testid={`variation-budget-${idx}`}>
                            <div className="font-semibold">Replace: {swap.targetIngredient}</div>
                            <div className="text-sm">With: {swap.replacement}</div>
                            <div className="text-sm text-muted-foreground mt-1">{swap.reason}</div>
                            <div className="text-sm text-purple-600 font-medium mt-1">{swap.impactSummary}</div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            </CardContent>
          </Card>
          )
        )}

        {recipe.culturalSignificance && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl flex items-center gap-2">
                <BookOpen className="h-6 w-6 text-primary" />
                History & Cultural Significance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-cultural-significance">
                {recipe.culturalSignificance.split('\n\n').map((paragraph: string, idx: number) => (
                  <p key={idx} className="text-muted-foreground leading-relaxed mb-4 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {recipe.celebrityChefReviews && recipe.celebrityChefReviews.length > 0 && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl flex items-center gap-2">
                <Star className="h-6 w-6 text-yellow-500" />
                Celebrity Chef Reviews
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6" data-testid="celebrity-chef-reviews">
                {(recipe.celebrityChefReviews ?? []).map((review: any, idx: number) => {
                  const getChefStyle = (chefName: string) => {
                    switch (chefName) {
                      case 'Gordon Ramsay':
                        return {
                          borderColor: 'border-red-500',
                          bgColor: 'bg-red-50 dark:bg-red-950/20',
                          scoreColor: 'text-red-600 dark:text-red-400',
                          iconColor: 'text-red-500',
                          Icon: Flame
                        };
                      case 'Ina Garten':
                        return {
                          borderColor: 'border-blue-500',
                          bgColor: 'bg-blue-50 dark:bg-blue-950/20',
                          scoreColor: 'text-blue-600 dark:text-blue-400',
                          iconColor: 'text-blue-500',
                          Icon: Heart
                        };
                      case 'Matty Matheson':
                        return {
                          borderColor: 'border-orange-500',
                          bgColor: 'bg-orange-50 dark:bg-orange-950/20',
                          scoreColor: 'text-orange-600 dark:text-orange-400',
                          iconColor: 'text-orange-500',
                          Icon: Drumstick
                        };
                      default:
                        return {
                          borderColor: 'border-primary',
                          bgColor: 'bg-muted/50',
                          scoreColor: 'text-primary',
                          iconColor: 'text-primary',
                          Icon: ChefHat
                        };
                    }
                  };
                  const style = getChefStyle(review.chefName);
                  const IconComponent = style.Icon;

                  return (
                    <div 
                      key={idx} 
                      className={`border-l-4 ${style.borderColor} ${style.bgColor} p-4`}
                      data-testid={`chef-review-${review.chefName?.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <IconComponent className={`h-6 w-6 ${style.iconColor}`} />
                          <div>
                            <div className="font-bold text-lg">{review.chefName}</div>
                            <div className="text-xs text-muted-foreground">{review.philosophy}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`text-3xl font-bold ${style.scoreColor}`}>{review.score}</span>
                          <span className="text-sm text-muted-foreground">/10</span>
                        </div>
                      </div>
                      <p className={`text-sm leading-relaxed ${review.chefName === 'Matty Matheson' ? 'font-bold' : ''}`}>
                        "{review.review}"
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {((recipe.allergens && recipe.allergens.length > 0) || (recipe.allergenFreeTags && recipe.allergenFreeTags.length > 0)) && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl">
                Allergen Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                {recipe.allergens && recipe.allergens.length > 0 && (
                  <AccordionItem value="allergens" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-allergens">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span>Contains Allergens ({recipe.allergens.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-wrap gap-2 pt-2">
                        {(recipe.allergens ?? []).map((allergen: string) => (
                          <Badge
                            key={allergen}
                            variant="destructive"
                            data-testid={`badge-allergen-${allergen}`}
                          >
                            {allergen}
                          </Badge>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {recipe.allergenFreeTags && recipe.allergenFreeTags.length > 0 && (
                  <AccordionItem value="allergen-free" className="border-0">
                    <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-allergen-free">
                      <div className="flex items-center gap-2">
                        <Info className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                        <span>Allergen-Free ({recipe.allergenFreeTags.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-wrap gap-2 pt-2">
                        {(recipe.allergenFreeTags ?? []).map((tag: string) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            data-testid={`badge-allergen-free-${tag}`}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            </CardContent>
          </Card>
        )}

        {activeDietaryFlags.length > 0 && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl">
                Dietary Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                <AccordionItem value="dietary" className="border-0">
                  <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-dietary">
                    <div className="flex items-center gap-2">
                      <ChefHat className="h-4 w-4 text-primary" />
                      <span>Dietary Tags ({activeDietaryFlags.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {activeDietaryFlags.map((flag: string) => (
                        <Badge
                          key={flag}
                          variant="secondary"
                          data-testid={`badge-dietary-${flag}`}
                        >
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}

        {(recipe.calories != null ||
          recipe.protein != null ||
          recipe.carbohydrates != null ||
          recipe.fat != null) && (
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-xl">
                Nutrition Facts
              </CardTitle>
              <p className="text-sm text-muted-foreground" data-testid="text-serving-size">
                {recipe.servingSize ? (
                  <>Per serving ({recipe.servingSize}){recipe.servings > 1 ? ` \u00B7 Makes ${recipe.servings} servings` : ''}</>
                ) : (
                  <>Per serving{recipe.servings > 1 ? ` (makes ${recipe.servings} servings)` : ''}</>
                )}
              </p>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible defaultValue="nutrition">
                <AccordionItem value="nutrition" className="border-0">
                  <AccordionTrigger className="min-h-11 py-2" data-testid="button-toggle-nutrition">
                    <div className="flex items-center gap-2">
                      <Utensils className="h-4 w-4 text-primary" />
                      <span>Nutritional Information</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      {recipe.calories != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {Math.round(recipe.calories)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Calories
                          </div>
                        </div>
                      )}
                      {recipe.protein != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {recipe.protein.toFixed(1)}g
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Protein
                          </div>
                        </div>
                      )}
                      {recipe.carbohydrates != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {recipe.carbohydrates.toFixed(1)}g
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Carbs
                          </div>
                        </div>
                      )}
                      {recipe.fat != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {recipe.fat.toFixed(1)}g
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Fat
                          </div>
                        </div>
                      )}
                      {recipe.fiber != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {recipe.fiber.toFixed(1)}g
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Fiber
                          </div>
                        </div>
                      )}
                      {recipe.sugar != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {recipe.sugar.toFixed(1)}g
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Sugar
                          </div>
                        </div>
                      )}
                      {recipe.sodium != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {Math.round(recipe.sodium)}mg
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Sodium
                          </div>
                        </div>
                      )}
                      {recipe.cholesterol != null && (
                        <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-2xl font-bold text-primary">
                            {Math.round(recipe.cholesterol)}mg
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Cholesterol
                          </div>
                        </div>
                      )}
                      {recipe.healthScore != null && (
                        <div className="col-span-2 flex flex-col items-center p-3 bg-muted rounded-md">
                          <div className="text-3xl font-bold text-primary">
                            {recipe.healthScore}/100
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Health Score
                          </div>
                        </div>
                      )}
                    </div>
                    {nutritionQualityTags.length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <div className="text-xs text-muted-foreground mb-2">
                          Nutrition Highlights
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {nutritionQualityTags.map((tag: string) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="text-xs"
                              data-testid={`badge-nutrition-${tag}`}
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}


      {recipe.tips && recipe.tips.length > 0 && (
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              Tips & Techniques
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {Object.entries(tipsByType || {}).map(([type, tips]) => (
                <AccordionItem key={type} value={type}>
                  <AccordionTrigger className="capitalize" data-testid={`button-toggle-tips-${type}`}>
                    {type.replace(/([A-Z])/g, ' $1').trim()} Tips
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-2">
                      {(tips as any[]).map((tip: any, idx: number) => (
                        <li key={idx} className="flex gap-2" data-testid={`text-tip-${type}-${idx}`}>
                          <span className="text-primary mt-1.5">•</span>
                          <span>{tip.text}</span>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {recipe.variations && recipe.variations.length > 0 && (
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Variations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(variationsByType || {}).map(([type, variations]) => (
              <div key={type}>
                <h4 className="font-semibold capitalize mb-3">{type} Variations</h4>
                <div className="space-y-3">
                  {(variations as any[]).map((variation: any, idx: number) => (
                    <div key={idx} data-testid={`variation-${type}-${idx}`}>
                      <div className="font-medium">{variation.title}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {variation.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {recipe.servingSuggestions && recipe.servingSuggestions.length > 0 && (
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="font-serif text-xl">
              Serving Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(recipe.servingSuggestions ?? []).map((suggestion: string, idx: number) => (
                <li
                  key={idx}
                  className="flex gap-2"
                  data-testid={`text-serving-suggestion-${idx}`}
                >
                  <span className="text-primary mt-1.5">•</span>
                  <span className="text-lg">{suggestion}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Whether any extra content exists (or is still being generated) */
export function hasRecipeExtras(recipe: Recipe): boolean {
  const r: any = recipe;
  const nonEmpty = (v: any) => Array.isArray(v) ? v.length > 0 : !!v;
  return (
    recipe.contentEnrichmentStatus === "enriching" ||
    nonEmpty(r.cuisines) || !!r.cuisine || nonEmpty(r.occasionTags) || nonEmpty(r.cookingMethods) || nonEmpty(r.seasonTags) ||
    r.totalCost != null || r.costExcludingStaples != null || r.priceRangeMin != null || !!r.priceCategory || !!r.skillLevel ||
    !!r.beveragePairings || !!r.recipeVariations || !!r.culturalSignificance || nonEmpty(r.celebrityChefReviews) ||
    nonEmpty(r.allergens) || nonEmpty(r.allergenFreeTags) || getDietaryFlags(recipe).length > 0 ||
    r.calories != null || r.protein != null || r.carbohydrates != null || r.fat != null ||
    nonEmpty(r.tips) || nonEmpty(r.variations) || nonEmpty(r.servingSuggestions)
  );
}

export function RecipeExtras({ recipe, open, onOpenChange }: { recipe: Recipe; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!hasRecipeExtras(recipe)) return null;
  return (
    <section aria-labelledby="extras-heading" className="border-t pt-6">
      <h2 id="extras-heading" className="font-serif text-2xl font-bold">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls={open ? "extras-content" : undefined}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="button-toggle-more-from-grammie"
        >
          <span>More from Grammie</span>
          <ChevronDown className={`h-6 w-6 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h2>
      {!open && (
        <p className="mt-1 text-base text-muted-foreground">
          Pairings, swaps, nutrition, tips, history and more.
        </p>
      )}
      {open && (
        <div id="extras-content" className="mt-4">
          <ExtrasContent recipe={recipe} />
        </div>
      )}
    </section>
  );
}
