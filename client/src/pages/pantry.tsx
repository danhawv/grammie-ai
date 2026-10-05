import { Redirect } from "wouter";

// Moved into the Kitchen area (client/src/pages/kitchen.tsx). Old links and
// bookmarks to /pantry land on the matching tab.
export default function PantryRedirect() {
  return <Redirect to="/kitchen?tab=pantry" replace />;
}
