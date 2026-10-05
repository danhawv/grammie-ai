import { Redirect } from "wouter";

// Moved into the Kitchen area (client/src/pages/kitchen.tsx). Old links and
// bookmarks to /meal-plans land on the matching tab.
export default function MealPlansRedirect() {
  return <Redirect to="/kitchen?tab=meal-plans" replace />;
}
