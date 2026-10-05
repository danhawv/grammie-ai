import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Copy, MoreHorizontal, Package, Plus, Share2, ShoppingCart, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-states";
import { useToast } from "@/hooks/use-toast";
import { useUndoable } from "@/hooks/use-undoable";
import { useHiddenIds } from "./use-hidden-ids";
import type { GroceryListItemsByAisle, GroceryListItemWithDisplay, PantryItem } from "@shared/schema";
import { findPantryItem } from "@shared/pantry-match";

type UnitSystem = "us" | "metric";

const GROCERY_KEYS = [["/api/grocery-list/by-aisle"], ["/api/grocery-list"]] as const;
function invalidateGrocery() {
  GROCERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] }));
}
function invalidatePantry() {
  queryClient.invalidateQueries({ queryKey: ["/api/pantry/items"] });
  queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
  queryClient.invalidateQueries({ queryKey: ["/api/pantry/restock"] });
}

function readBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}
function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode: setting just won't persist */
  }
}

function formatQuantity(qty: number | null | undefined): string {
  if (qty === null || qty === undefined) return "";
  if (Number.isInteger(qty)) return qty.toString();
  const rounded = Math.round(qty * 4) / 4;
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

/** "For Lemon Chicken" / "For Lemon Chicken and 2 more" */
function sourceLabel(item: GroceryListItemWithDisplay): string | null {
  const entries = (item.originalEntries || []) as { recipeTitle?: string }[];
  const titles = Array.from(new Set(entries.map((e) => e.recipeTitle).filter(Boolean))) as string[];
  if (titles.length === 0) return null;
  if (titles.length === 1) return `For ${titles[0]}`;
  if (titles.length === 2) return `For ${titles[0]} and ${titles[1]}`;
  return `For ${titles[0]} and ${titles.length - 1} more`;
}

export function GroceryPanel({ onOpenPantry }: { onOpenPantry: () => void }) {
  const { toast } = useToast();
  const undoable = useUndoable();
  const { hidden, hide, show } = useHiddenIds();
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("us");
  const [newItem, setNewItem] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hideHave, setHideHave] = useState(() => readBool("grocery-hide-have", false));
  // Existing preference: checked-off items move into the pantry (default on)
  const [addToPantry, setAddToPantry] = useState(() => readBool("grocery-add-to-pantry", true));

  const { data: authStatus } = useQuery<{ user: { preferences?: { unitSystem?: UnitSystem } } }>({
    queryKey: ["/api/auth/status"],
  });
  useEffect(() => {
    const pref = authStatus?.user?.preferences?.unitSystem;
    if (pref) setUnitSystem(pref);
  }, [authStatus]);

  const { data: groceryList, isLoading, isError, refetch } = useQuery<GroceryListItemsByAisle[]>({
    queryKey: ["/api/grocery-list/by-aisle"],
  });
  const { data: pantryItems } = useQuery<PantryItem[]>({ queryKey: ["/api/pantry"] });

  const addItemMutation = useMutation({
    mutationFn: async (name: string) => apiRequest("POST", "/api/grocery-list/items", { item: name, displayName: name }),
    onSuccess: () => {
      setNewItem("");
      invalidateGrocery();
    },
    onError: () => {
      toast({ title: "Couldn't add that item", description: "Check your connection and try again.", variant: "destructive" });
    },
  });

  const unitMutation = useMutation({
    mutationFn: async (system: UnitSystem) => apiRequest("PATCH", "/api/user/preferences/unit-system", { unitSystem: system }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/by-aisle"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/grocery-list/share", {})).json(),
    onSuccess: (data: { token: string }) => setShareLink(`${window.location.origin}/grocery-list/shared/${data.token}`),
  });

  // Pantry lookups, computed once per list/pantry change
  const pantryMatches = useMemo(() => {
    const map = new Map<string, PantryItem>();
    if (!groceryList || !pantryItems?.length) return map;
    for (const aisle of groceryList) {
      for (const item of aisle.items) {
        const match = findPantryItem(item.displayName || item.item, pantryItems);
        if (match) map.set(item.id, match);
      }
    }
    return map;
  }, [groceryList, pantryItems]);

  const visibleAisles = useMemo(() => {
    return (groceryList || [])
      .map((aisle) => ({
        ...aisle,
        items: aisle.items.filter((i) => !hidden.has(i.id) && !(hideHave && pantryMatches.has(i.id))),
      }))
      .filter((aisle) => aisle.items.length > 0);
  }, [groceryList, hidden, hideHave, pantryMatches]);

  const allItems = useMemo(
    () => (groceryList || []).flatMap((a) => a.items).filter((i) => !hidden.has(i.id)),
    [groceryList, hidden],
  );
  const haveCount = allItems.filter((i) => pantryMatches.has(i.id)).length;
  const visibleCount = visibleAisles.reduce((n, a) => n + a.items.length, 0);

  const name = (item: GroceryListItemWithDisplay) => item.displayName || item.item;

  const checkOff = (item: GroceryListItemWithDisplay) => {
    // Mark it checked right away (shared shoppers see it), move it out after the Undo window
    apiRequest("PATCH", `/api/grocery-list/items/${item.id}/toggle`, { checked: true }).catch(() => {});
    const toPantry = addToPantry;
    undoable({
      message: toPantry ? `Got ${name(item)} · added to Pantry` : `Got ${name(item)}`,
      hide: () => hide([item.id]),
      restore: () => {
        show([item.id]);
        apiRequest("PATCH", `/api/grocery-list/items/${item.id}/toggle`, { checked: false }).catch(() => {});
      },
      commit: async () => {
        await apiRequest("POST", "/api/grocery-list/items/checkout", { itemIds: [item.id], addToPantry: toPantry });
        invalidateGrocery();
        if (toPantry) invalidatePantry();
      },
    });
  };

  const removeItem = (item: GroceryListItemWithDisplay) => {
    undoable({
      message: `Removed ${name(item)}`,
      hide: () => hide([item.id]),
      restore: () => show([item.id]),
      commit: async () => {
        await apiRequest("DELETE", `/api/grocery-list/items/${item.id}`);
        invalidateGrocery();
      },
    });
  };

  const clearList = () => {
    const ids = allItems.map((i) => i.id);
    if (ids.length === 0) return;
    undoable({
      message: `Cleared ${ids.length} item${ids.length === 1 ? "" : "s"}`,
      hide: () => hide(ids),
      restore: () => show(ids),
      // Delete exactly these items, so anything added during the Undo window stays
      commit: async () => {
        const results = await Promise.allSettled(ids.map((id) => apiRequest("DELETE", `/api/grocery-list/items/${id}`)));
        invalidateGrocery();
        if (results.some((r) => r.status === "rejected")) throw new Error("Some items weren't removed");
      },
    });
  };

  const changeUnits = (system: UnitSystem) => {
    const previous = unitSystem;
    setUnitSystem(system);
    unitMutation.mutate(system, { onError: () => setUnitSystem(previous) });
  };

  const openShare = () => {
    setShareOpen(true);
    if (!shareLink && !shareMutation.isPending) shareMutation.mutate();
  };

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link stays selectable in the field */
    }
  };

  const addForm = (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const value = newItem.trim();
        if (value) addItemMutation.mutate(value);
      }}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor="grocery-add-item" className="text-sm font-medium">
          Add an item
        </Label>
        <Input
          id="grocery-add-item"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="e.g. paper towels"
          autoComplete="off"
          className="h-11 text-base"
          data-testid="input-grocery-add"
        />
      </div>
      <Button type="submit" disabled={!newItem.trim() || addItemMutation.isPending} data-testid="button-grocery-add">
        <Plus aria-hidden />
        Add
      </Button>
    </form>
  );

  if (isLoading) return <LoadingState label="Loading your grocery list" rows={6} />;
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your grocery list"
        description="Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="space-y-6">
        {addForm}
        <EmptyState
          icon={ShoppingCart}
          title="Your grocery list is empty"
          description="Open any recipe and choose “Add to grocery list”, or type an item above. Items show which recipe they're for."
          action={
            <Button asChild variant="outline">
              <Link href="/">Browse recipes</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {addForm}

      {/* List controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2">
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id="grocery-hide-have"
            checked={hideHave}
            onCheckedChange={(v) => {
              setHideHave(v);
              writeBool("grocery-hide-have", v);
            }}
            data-testid="switch-hide-have"
          />
          <Label htmlFor="grocery-hide-have" className="cursor-pointer text-base">
            Hide items I have{haveCount > 0 ? ` (${haveCount})` : ""}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onOpenPantry} data-testid="button-open-pantry">
            <Package aria-hidden />
            Pantry
          </Button>
          <Button variant="outline" onClick={openShare} data-testid="button-share-list">
            <Share2 aria-hidden />
            Share
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More list options" data-testid="button-grocery-more">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Show amounts in</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={unitSystem} onValueChange={(v) => changeUnits(v as UnitSystem)}>
                <DropdownMenuRadioItem value="us" className="min-h-11 text-base">US (cups, oz)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="metric" className="min-h-11 text-base">Metric (g, ml)</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={addToPantry}
                onCheckedChange={(v) => {
                  const value = Boolean(v);
                  setAddToPantry(value);
                  writeBool("grocery-add-to-pantry", value);
                }}
                className="min-h-11 text-base"
              >
                Add checked-off items to my Pantry
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {visibleCount === 0 ? (
        <EmptyState
          icon={Package}
          title="You have everything on this list"
          description="Every item matches something in your pantry. Turn off “Hide items I have” to see them."
          action={
            <Button variant="outline" onClick={() => { setHideHave(false); writeBool("grocery-hide-have", false); }}>
              Show all items
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {visibleAisles.map((aisle) => (
            <section key={aisle.aisle} aria-labelledby={`aisle-${aisle.aisle}`} data-testid={`aisle-${aisle.aisle}`}>
              <h3 id={`aisle-${aisle.aisle}`} className="mb-2 border-b pb-2 text-sm font-semibold text-muted-foreground">
                {aisle.aisle}
              </h3>
              <ul className="space-y-2">
                {aisle.items.map((item) => {
                  const pantryMatch = pantryMatches.get(item.id);
                  const pantryQty = pantryMatch?.quantity
                    ? `${formatQuantity(pantryMatch.quantity)} ${pantryMatch.unit || ""}`.trim()
                    : null;
                  const qty = item.displayText || (item.quantity ? `${formatQuantity(item.quantity)} ${item.unit || ""}`.trim() : "");
                  const source = sourceLabel(item);
                  const checkboxId = `grocery-item-${item.id}`;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-1 rounded-lg border bg-card pl-1 pr-1"
                      data-testid={`grocery-item-${item.id}`}
                    >
                      <label htmlFor={checkboxId} className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2">
                        <Checkbox
                          id={checkboxId}
                          checked={item.checked}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              checkOff(item);
                            } else {
                              // Checked elsewhere (e.g. on a shared list): uncheck it
                              apiRequest("PATCH", `/api/grocery-list/items/${item.id}/toggle`, { checked: false })
                                .then(invalidateGrocery)
                                .catch(() => {});
                            }
                          }}
                          className="h-6 w-6"
                          data-testid={`checkbox-${item.id}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-base ${item.checked ? "text-muted-foreground line-through" : ""}`}>
                            {name(item)}
                          </span>
                          {(source || pantryMatch) && (
                            <span className="block truncate text-sm text-muted-foreground" title={source || undefined}>
                              {source}
                              {source && pantryMatch ? " · " : ""}
                              {pantryMatch && (
                                <span className="font-medium text-green-800 dark:text-green-300">
                                  In your pantry{pantryQty ? `: ${pantryQty}` : ""}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                        {qty && <span className="shrink-0 text-base text-muted-foreground">{qty}</span>}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(item)}
                        aria-label={`Remove ${name(item)}`}
                        title={`Remove ${name(item)}`}
                        data-testid={`delete-${item.id}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="border-t pt-6">
        <Button variant="outline" className="w-full sm:w-auto" onClick={clearList} data-testid="button-clear-list">
          <Trash2 aria-hidden />
          Clear list
        </Button>
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share your grocery list</DialogTitle>
            <DialogDescription>Anyone with this link can see the list and check items off as they shop.</DialogDescription>
          </DialogHeader>
          {shareMutation.isPending ? (
            <p className="text-base text-muted-foreground" role="status">Making a link…</p>
          ) : shareMutation.isError ? (
            <div className="space-y-3" role="alert">
              <p className="text-base">Couldn't make a share link. Check your connection and try again.</p>
              <Button onClick={() => shareMutation.mutate()}>Try again</Button>
            </div>
          ) : shareLink ? (
            <div className="space-y-2">
              <Label htmlFor="grocery-share-link">Share link</Label>
              <div className="flex gap-2">
                <Input
                  id="grocery-share-link"
                  readOnly
                  value={shareLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 flex-1"
                  data-testid="input-share-link"
                />
                <Button onClick={copyLink} data-testid="button-copy-link">
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
