import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trash2, ShoppingCart, Scale, Plus, Share2, Copy, Check, Package, Home, Undo2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { GroceryListItemsByAisle, PantryItem } from "@shared/schema";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link } from "wouter";

interface UndoItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string;
  timestamp: number;
}

export default function GroceryListPage() {
  const { toast } = useToast();
  const [unitSystem, setUnitSystem] = useState<'metric' | 'us'>('us');
  const [fadingItems, setFadingItems] = useState<Set<string>>(new Set());
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  // Undo functionality - track recently checked items
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const undoTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const { data: authStatus } = useQuery<{ user: { preferences?: { unitSystem?: 'metric' | 'us' } } }>({
    queryKey: ['/api/auth/status'],
  });

  useEffect(() => {
    if (authStatus?.user?.preferences?.unitSystem) {
      setUnitSystem(authStatus.user.preferences.unitSystem);
    }
  }, [authStatus]);

  const { data: groceryList, isLoading } = useQuery<GroceryListItemsByAisle[]>({
    queryKey: ['/api/grocery-list/by-aisle'],
  });

  // Fetch pantry items to highlight what user already has
  const { data: pantryItems } = useQuery<PantryItem[]>({
    queryKey: ['/api/pantry'],
  });

  // Unit conversion constants
  const conversions: Record<string, { usUnit: string; factor: number }> = {
    'ml': { usUnit: 'fl oz', factor: 0.033814 },
    'l': { usUnit: 'cups', factor: 4.22675 },
    'L': { usUnit: 'cups', factor: 4.22675 },
    'g': { usUnit: 'oz', factor: 0.035274 },
    'kg': { usUnit: 'lb', factor: 2.20462 },
  };

  // Format quantity for display - round to sensible precision
  const formatQuantity = (qty: number | null | undefined): string => {
    if (qty === null || qty === undefined) return '';
    if (Number.isInteger(qty)) return qty.toString();
    // Round to nearest 0.25 for common fractions or 1 decimal for others
    const rounded = Math.round(qty * 4) / 4; // Round to nearest quarter
    if (Number.isInteger(rounded)) return rounded.toString();
    return rounded.toFixed(2).replace(/\.?0+$/, ''); // Remove trailing zeros
  };

  // Convert and format quantity based on unit system preference
  const convertQuantity = (qty: number | null | undefined, unit: string | null | undefined): { quantity: string; unit: string } => {
    if (qty === null || qty === undefined) return { quantity: '', unit: unit || '' };
    
    const normalizedUnit = unit?.toLowerCase().trim() || '';
    
    // If user wants US units and we have a metric unit, convert it
    if (unitSystem === 'us' && conversions[normalizedUnit]) {
      const conversion = conversions[normalizedUnit];
      const convertedQty = qty * conversion.factor;
      return { 
        quantity: formatQuantity(convertedQty), 
        unit: conversion.usUnit 
      };
    }
    
    // Otherwise just format the existing quantity
    return { quantity: formatQuantity(qty), unit: unit || '' };
  };

  // Function to find matching pantry item with quantity info
  const getPantryMatch = (itemName: string): PantryItem | null => {
    if (!itemName || !pantryItems) return null;
    const normalizedName = itemName.toLowerCase().trim();
    
    // Direct match first
    const directMatch = pantryItems.find(item => 
      item.name.toLowerCase().trim() === normalizedName
    );
    if (directMatch) return directMatch;
    
    // Partial match
    for (let i = 0; i < pantryItems.length; i++) {
      const pantryItem = pantryItems[i];
      const pantryName = pantryItem.name.toLowerCase().trim();
      if (pantryName.includes(normalizedName) || normalizedName.includes(pantryName)) {
        return pantryItem;
      }
    }
    return null;
  };

  // Clear undo item after timeout (10 seconds)
  const scheduleUndoClear = useCallback((itemId: string) => {
    const existingTimeout = undoTimeoutRef.current.get(itemId);
    if (existingTimeout) clearTimeout(existingTimeout);
    
    const timeout = setTimeout(() => {
      setUndoStack(prev => prev.filter(item => item.id !== itemId));
      undoTimeoutRef.current.delete(itemId);
    }, 10000); // 10 second window to undo
    
    undoTimeoutRef.current.set(itemId, timeout);
  }, []);

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, checked }: { itemId: string; checked: boolean }) => {
      return apiRequest('PATCH', `/api/grocery-list/items/${itemId}/toggle`, { checked });
    },
    onMutate: async ({ itemId, checked }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      
      // Snapshot previous value
      const previousData = queryClient.getQueryData<GroceryListItemsByAisle[]>(['/api/grocery-list/by-aisle']);
      
      // Find the item being checked for undo functionality
      if (checked && previousData) {
        for (const aisle of previousData) {
          const item = aisle.items.find(i => i.id === itemId);
          if (item) {
            const undoItem: UndoItem = {
              id: item.id,
              name: item.displayName || item.item,
              quantity: item.quantity,
              unit: item.unit,
              aisle: aisle.aisle,
              timestamp: Date.now(),
            };
            setUndoStack(prev => [undoItem, ...prev.slice(0, 4)]); // Keep last 5
            scheduleUndoClear(itemId);
            break;
          }
        }
      }
      
      // Optimistically update the item
      queryClient.setQueryData<GroceryListItemsByAisle[]>(['/api/grocery-list/by-aisle'], (old) => {
        if (!old) return old;
        return old.map(aisle => ({
          ...aisle,
          items: aisle.items.map(item => 
            item.id === itemId ? { ...item, checked } : item
          )
        }));
      });

      // If checking the item, schedule fade and removal
      if (checked) {
        setTimeout(() => {
          setFadingItems(prev => new Set(prev).add(itemId));
        }, 400);
        
        setTimeout(() => {
          // Remove from local state immediately
          queryClient.setQueryData<GroceryListItemsByAisle[]>(['/api/grocery-list/by-aisle'], (old) => {
            if (!old) return old;
            return old.map(aisle => ({
              ...aisle,
              items: aisle.items.filter(item => item.id !== itemId)
            })).filter(aisle => aisle.items.length > 0);
          });
          
          // Then remove from server
          removeItemMutation.mutate(itemId);
          
          setFadingItems(prev => {
            const next = new Set(prev);
            next.delete(itemId);
            return next;
          });
        }, 1000);
      }

      return { previousData };
    },
    onError: (err, { itemId }, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['/api/grocery-list/by-aisle'], context.previousData);
      }
      setFadingItems(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest('DELETE', `/api/grocery-list/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (item: { name: string; quantity?: number; unit?: string; aisle?: string }) => {
      return apiRequest('POST', '/api/grocery-list/items', item);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
    },
  });

  const clearListMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', '/api/grocery-list');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
      toast({
        title: "List cleared",
        description: "All items removed",
      });
    },
  });

  const updateUnitSystemMutation = useMutation({
    mutationFn: async (unitSystem: 'metric' | 'us') => {
      return apiRequest('PATCH', '/api/user/preferences/unit-system', { unitSystem });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/status'] });
    },
  });

  const createShareMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/grocery-list/share', {});
    },
    onSuccess: (data: any) => {
      const link = `${window.location.origin}/grocery-list/shared/${data.token}`;
      setShareLink(link);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to create share link', variant: 'destructive' });
    },
  });

  // Undo handler - restore the item
  const handleUndo = useCallback((undoItem: UndoItem) => {
    // Clear the timeout for this item
    const timeout = undoTimeoutRef.current.get(undoItem.id);
    if (timeout) {
      clearTimeout(timeout);
      undoTimeoutRef.current.delete(undoItem.id);
    }
    
    // Remove from undo stack
    setUndoStack(prev => prev.filter(item => item.id !== undoItem.id));
    
    // Re-add the item to the grocery list
    addItemMutation.mutate({
      name: undoItem.name,
      quantity: undoItem.quantity ?? undefined,
      unit: undoItem.unit ?? undefined,
      aisle: undoItem.aisle,
    });
    
    toast({
      title: "Item restored",
      description: `${undoItem.name} added back to list`,
    });
  }, [addItemMutation, toast]);

  const handleShare = () => {
    setIsShareDialogOpen(true);
    if (!shareLink) {
      createShareMutation.mutate();
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied!', description: 'Share link copied to clipboard' });
  };

  const handleUnitSystemToggle = () => {
    const previousSystem = unitSystem;
    const newSystem = unitSystem === 'metric' ? 'us' : 'metric';
    setUnitSystem(newSystem);
    updateUnitSystemMutation.mutate(newSystem, {
      onError: () => {
        setUnitSystem(previousSystem);
      },
    });
  };

  const totalItems = groceryList?.reduce((sum, aisle) => sum + aisle.items.length, 0) || 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold" data-testid="text-groceries-title">Groceries</h1>
          <div className="flex items-center gap-2">
            <Link href="/pantry">
              <Button variant="outline" size="sm" className="text-xs" data-testid="button-pantry">
                <Package className="w-3.5 h-3.5 mr-1.5" />
                Pantry
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnitSystemToggle}
              disabled={updateUnitSystemMutation.isPending}
              className="text-xs"
              data-testid="button-toggle-units"
            >
              <Scale className="w-3.5 h-3.5 mr-1.5" />
              {unitSystem === 'metric' ? 'Metric' : 'US'}
            </Button>
            {totalItems > 0 && (
              <>
                <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleShare}
                      className="text-xs"
                      data-testid="button-share-list"
                    >
                      <Share2 className="w-3.5 h-3.5 mr-1.5" />
                      Share
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Share Grocery List</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Share this link with others to shop together in real-time.
                      </p>
                      {createShareMutation.isPending ? (
                        <div className="text-center py-4">
                          <p className="text-sm text-muted-foreground">Creating share link...</p>
                        </div>
                      ) : shareLink ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value={shareLink}
                            className="flex-1 px-3 py-2 text-sm bg-muted rounded-md border"
                            data-testid="input-share-link"
                          />
                          <Button onClick={handleCopyLink} size="sm" data-testid="button-copy-link">
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm('Clear entire list?')) {
                      clearListMutation.mutate();
                    }
                  }}
                  disabled={clearListMutation.isPending}
                  className="text-destructive hover:text-destructive text-xs"
                  data-testid="button-clear-list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Undo Toast - shows when there are recently checked items */}
        {undoStack.length > 0 && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-200">
            <div className="bg-foreground text-background px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
              <span className="text-sm font-medium">
                {undoStack[0].name} checked off
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleUndo(undoStack[0])}
                className="h-7 px-2"
                data-testid="button-undo-check"
              >
                <Undo2 className="w-3.5 h-3.5 mr-1" />
                Undo
              </Button>
            </div>
          </div>
        )}

        {/* Grocery List Content */}
        {totalItems === 0 ? (
          <div className="text-center py-16">
            <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-2">Your grocery list is empty</p>
            <p className="text-sm text-muted-foreground/70 mb-6">
              Add recipes to build your shopping list
            </p>
            <Link href="/">
              <Button variant="outline" data-testid="button-browse-recipes">
                <Home className="w-4 h-4 mr-2" />
                Browse Recipes
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {groceryList?.map((aisleGroup) => (
              <div key={aisleGroup.aisle} data-testid={`aisle-${aisleGroup.aisle}`}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-2 border-b">
                  {aisleGroup.aisle}
                </div>
                <div className="space-y-1">
                  {aisleGroup.items.map((item) => {
                    const pantryMatch = getPantryMatch(item.displayName || item.item);
                    const pantryConverted = pantryMatch ? convertQuantity(pantryMatch.quantity, pantryMatch.unit) : null;
                    const pantryQtyDisplay = pantryConverted && pantryConverted.quantity 
                      ? `${pantryConverted.quantity} ${pantryConverted.unit}`.trim()
                      : null;
                    // Use displayText from backend which preserves original recipe units
                    const itemQtyDisplay = (item as any).displayText || 
                      (item.quantity ? `${formatQuantity(item.quantity)} ${item.unit || ''}`.trim() : null);
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 py-2.5 px-3 rounded-lg transition-all duration-300
                          ${fadingItems.has(item.id) ? 'opacity-0 scale-95' : 'opacity-100'}
                          ${item.checked ? 'bg-muted/50' : 'bg-card border'}
                        `}
                        data-testid={`grocery-item-${item.id}`}
                      >
                        <Checkbox
                          checked={item.checked}
                          onCheckedChange={(checked) => {
                            toggleItemMutation.mutate({ itemId: item.id, checked: Boolean(checked) });
                          }}
                          data-testid={`checkbox-${item.id}`}
                        />
                        
                        {/* Item name with emoji */}
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm ${item.checked ? 'line-through text-muted-foreground' : ''}`}>
                            {item.displayName || item.item}
                          </span>
                        </div>
                        
                        {/* Pantry quantity bubble - clickable to go to pantry */}
                        {pantryMatch && (
                          <Link href="/pantry">
                            <span 
                              className="text-xs px-2 py-1 bg-green-500/20 text-green-600 rounded-full font-medium cursor-pointer hover:bg-green-500/30 transition-colors shrink-0"
                              data-testid={`pantry-link-${item.id}`}
                            >
                              {pantryQtyDisplay || 'have'}
                            </span>
                          </Link>
                        )}
                        
                        {/* Required quantity on right */}
                        {itemQtyDisplay && (
                          <span className={`text-sm text-muted-foreground shrink-0 ${item.checked ? 'line-through' : ''}`}>
                            {itemQtyDisplay}
                          </span>
                        )}
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-50 hover:opacity-100 shrink-0"
                          onClick={() => removeItemMutation.mutate(item.id)}
                          data-testid={`delete-${item.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Back to home link */}
        <div className="mt-8 pt-6 border-t">
          <Link href="/">
            <Button variant="outline" className="w-full" data-testid="button-back-home">
              <Home className="w-4 h-4 mr-2" />
              Back to Recipes
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
