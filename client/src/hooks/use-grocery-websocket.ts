import { useEffect, useRef, useCallback, useState } from 'react';
import { queryClient } from '@/lib/queryClient';
import type { GroceryListItemsByAisle } from '@shared/schema';

type GroceryListUpdateMessage = 
  | { type: 'item_checked'; itemId: string; checked: boolean; actorName: string }
  | { type: 'item_added'; item: any; actorName: string }
  | { type: 'item_removed'; itemId: string; actorName: string }
  | { type: 'collaborator_joined'; collaborator: any }
  | { type: 'collaborator_left'; collaboratorId: string }
  | { type: 'presence_update'; collaborators: any[] }
  | { type: 'pong' };

interface UseGroceryWebSocketOptions {
  token: string;
  displayName: string;
  onMessage?: (message: GroceryListUpdateMessage) => void;
  onPresenceUpdate?: (collaborators: any[]) => void;
}

export function useGroceryWebSocket({ 
  token, 
  displayName, 
  onMessage,
  onPresenceUpdate 
}: UseGroceryWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<any[]>([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/grocery-list?token=${token}&name=${encodeURIComponent(displayName)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      setIsConnected(true);
      console.log('[WS] Connected to grocery list');
      
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };
    
    ws.onclose = (event) => {
      setIsConnected(false);
      console.log('[WS] Disconnected:', event.code, event.reason);
      
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      
      if (event.code !== 1000 && event.code !== 4001) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
    
    ws.onmessage = (event) => {
      try {
        const message: GroceryListUpdateMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'item_checked':
            queryClient.setQueryData<{ items: GroceryListItemsByAisle[] }>(['/api/grocery-list/shared', token], (old) => {
              if (!old) return old;
              return {
                ...old,
                items: old.items.map(aisle => ({
                  ...aisle,
                  items: aisle.items.map(item => 
                    item.id === message.itemId ? { ...item, checked: message.checked } : item
                  )
                }))
              };
            });
            break;
            
          case 'item_removed':
            queryClient.setQueryData<{ items: GroceryListItemsByAisle[] }>(['/api/grocery-list/shared', token], (old) => {
              if (!old) return old;
              return {
                ...old,
                items: old.items.map(aisle => ({
                  ...aisle,
                  items: aisle.items.filter(item => item.id !== message.itemId)
                })).filter(aisle => aisle.items.length > 0)
              };
            });
            break;
            
          case 'presence_update':
            setCollaborators(message.collaborators);
            onPresenceUpdate?.(message.collaborators);
            break;
        }
        
        onMessage?.(message);
      } catch (error) {
        console.error('[WS] Error parsing message:', error);
      }
    };
  }, [token, displayName, onMessage, onPresenceUpdate]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close(1000);
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const toggleItem = useCallback((itemId: string, checked: boolean) => {
    sendMessage({ type: 'toggle_item', itemId, checked });
  }, [sendMessage]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    collaborators,
    toggleItem,
    sendMessage,
    disconnect,
  };
}
