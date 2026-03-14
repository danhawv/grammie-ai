import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShoppingCart, Users, Loader2, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGroceryWebSocket } from "@/hooks/use-grocery-websocket";
import type { GroceryListItemsByAisle } from "@shared/schema";
import { useState, useEffect } from "react";
import { useParams } from "wouter";

export default function SharedGroceryListPage() {
  const { toast } = useToast();
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [fadingItems, setFadingItems] = useState<Set<string>>(new Set());

  const { data: sharedList, isLoading, error } = useQuery<{
    items: GroceryListItemsByAisle[];
    listName?: string;
    ownerName?: string;
  }>({
    queryKey: ['/api/grocery-list/shared', token],
    enabled: hasJoined && !!token,
  });

  const {
    isConnected,
    collaborators,
    toggleItem,
  } = useGroceryWebSocket({
    token: token || '',
    displayName,
    onMessage: (message) => {
      if (message.type === 'item_checked' && message.actorName !== displayName) {
        toast({
          title: message.checked ? 'Item checked' : 'Item unchecked',
          description: `${message.actorName} updated an item`,
        });
      }
    },
  });

  const handleJoin = () => {
    if (!displayName.trim()) {
      toast({ title: 'Name required', description: 'Please enter your name', variant: 'destructive' });
      return;
    }
    setHasJoined(true);
  };

  const handleToggleItem = (itemId: string, checked: boolean) => {
    toggleItem(itemId, checked);
    
    queryClient.setQueryData<{ items: GroceryListItemsByAisle[] }>(['/api/grocery-list/shared', token], (old) => {
      if (!old) return old;
      return {
        ...old,
        items: old.items.map(aisle => ({
          ...aisle,
          items: aisle.items.map(item => 
            item.id === itemId ? { ...item, checked } : item
          )
        }))
      };
    });

    if (checked) {
      setTimeout(() => {
        setFadingItems(prev => new Set(prev).add(itemId));
      }, 400);
      
      setTimeout(() => {
        queryClient.setQueryData<{ items: GroceryListItemsByAisle[] }>(['/api/grocery-list/shared', token], (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map(aisle => ({
              ...aisle,
              items: aisle.items.filter(item => item.id !== itemId)
            })).filter(aisle => aisle.items.length > 0)
          };
        });
        
        setFadingItems(prev => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }, 1000);
    }
  };

  if (!hasJoined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6 text-center">
          <div>
            <ShoppingCart className="w-12 h-12 mx-auto text-primary mb-4" />
            <h1 className="text-2xl font-bold mb-2">Join Shared Grocery List</h1>
            <p className="text-muted-foreground">
              Enter your name to start shopping together in real-time
            </p>
          </div>
          
          <div className="space-y-4">
            <Input
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              className="text-center text-lg"
              data-testid="input-display-name"
            />
            <Button 
              onClick={handleJoin} 
              className="w-full" 
              size="lg"
              data-testid="button-join"
            >
              Join Shopping
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <p className="text-muted-foreground">Loading list...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-2xl mx-auto text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">Link Invalid or Expired</h2>
          <p className="text-muted-foreground">
            This grocery list link is no longer available.
          </p>
        </div>
      </div>
    );
  }

  const groceryList = sharedList?.items || [];
  const totalItems = groceryList.reduce((sum, aisle) => sum + aisle.items.length, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-shared-title">
              Shared List
            </h1>
            {sharedList?.ownerName && (
              <p className="text-sm text-muted-foreground">by {sharedList.ownerName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? 'default' : 'secondary'} className="gap-1">
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Live' : 'Offline'}
            </Badge>
            {collaborators.length > 0 && (
              <Badge variant="outline" className="gap-1">
                <Users className="w-3 h-3" />
                {collaborators.length}
              </Badge>
            )}
          </div>
        </div>

        {collaborators.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {collaborators.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {c.displayName}
              </Badge>
            ))}
          </div>
        )}

        {totalItems === 0 ? (
          <div className="text-center py-16">
            <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">All items checked off!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groceryList.map((aisleGroup) => {
              const visibleItems = aisleGroup.items.filter(item => !fadingItems.has(item.id) || !item.checked);
              if (visibleItems.length === 0) return null;
              
              return (
                <div key={aisleGroup.aisle} data-testid={`aisle-${aisleGroup.aisle}`}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-2 border-b">
                    {aisleGroup.aisle}
                  </div>
                  
                  <div className="space-y-0">
                    {aisleGroup.items.map((item) => {
                      const isFading = fadingItems.has(item.id);
                      
                      return (
                        <div
                          key={item.id}
                          className={`
                            flex items-center gap-3 py-3 border-b border-border/50 last:border-b-0
                            transition-all duration-500 ease-out cursor-pointer
                            ${isFading ? 'opacity-0 h-0 py-0 overflow-hidden' : 'opacity-100'}
                            ${item.checked && !isFading ? 'opacity-50' : ''}
                          `}
                          data-testid={`item-${item.id}`}
                          onClick={() => {
                            if (!item.checked) {
                              handleToggleItem(item.id, true);
                            }
                          }}
                        >
                          <div 
                            className={`
                              w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0
                              transition-colors duration-200
                              ${item.checked 
                                ? 'border-primary bg-primary' 
                                : 'border-muted-foreground/30'
                              }
                            `}
                            data-testid={`checkbox-${item.id}`}
                          >
                            {item.checked && (
                              <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>

                          <span 
                            className={`
                              flex-1 text-base
                              ${item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}
                            `}
                          >
                            {item.displayName}
                          </span>

                          <span className="text-sm text-muted-foreground whitespace-nowrap">
                            {formatQuantity(item.quantity, item.unit, (item as any).displayText)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatQuantity(quantity: number, unit: string, displayText?: string): string {
  if (displayText) {
    return displayText;
  }
  
  const formattedQty = quantity % 1 === 0 
    ? quantity.toString() 
    : quantity.toFixed(1).replace(/\.0$/, '');
  
  if (!unit || unit === 'unit' || unit === 'units' || unit === 'item' || unit === 'items') {
    return formattedQty;
  }
  
  return `${formattedQty} ${unit}`;
}
