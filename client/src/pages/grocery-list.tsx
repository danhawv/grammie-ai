import { Redirect } from "wouter";

// Moved into the Kitchen area (client/src/pages/kitchen.tsx). Old links and
// bookmarks to /grocery-list land on the matching tab.
export default function GroceryListRedirect() {
  return <Redirect to="/kitchen?tab=grocery" replace />;
}
