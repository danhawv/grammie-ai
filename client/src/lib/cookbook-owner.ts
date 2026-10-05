// How a cookbook's owner is named on screen: "by Grandma Jean". Falls back to
// "you" for your own cookbook rather than "Unknown".

export interface CookbookOwner {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

export function ownerDisplayName(owner: CookbookOwner | undefined, viewerIsOwner: boolean): string {
  const full = [owner?.firstName, owner?.lastName].filter(Boolean).join(" ");
  if (viewerIsOwner) return full ? `${full} (you)` : "you";
  return full || owner?.username || "a Grammie cook";
}

export function ownerInitials(owner: CookbookOwner | undefined): string {
  const fromName = [owner?.firstName?.[0], owner?.lastName?.[0]].filter(Boolean).join("");
  return (fromName || owner?.username?.slice(0, 2) || "").toUpperCase();
}
