import { useEffect, useRef, useCallback, useState } from "react";
import { queryClient } from "@/lib/queryClient";

type MealPlanWsMessage =
  | { type: "entry_added"; entry: any }
  | { type: "entry_updated"; entry: any }
  | { type: "entry_removed"; entry: { id: string } }
  | { type: "entry_moved"; entry: any }
  | { type: "presence_update"; users: { userId: string; displayName: string }[] }
  | { type: "pong" };

interface UseMealPlanWebSocketOptions {
  planId: string;
  userId: string;
  enabled?: boolean;
}

export function useMealPlanWebSocket({
  planId,
  userId,
  enabled = true,
}: UseMealPlanWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<{ userId: string; displayName: string }[]>([]);

  const connect = useCallback(() => {
    if (!enabled || !planId || !userId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/meal-plan?planId=${planId}&userId=${userId}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Send periodic pings
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const message: MealPlanWsMessage = JSON.parse(event.data);

          switch (message.type) {
            case "presence_update":
              setOnlineUsers(message.users);
              break;
            case "entry_added":
            case "entry_updated":
            case "entry_removed":
            case "entry_moved":
              // Invalidate the meal plan query to refetch fresh data
              queryClient.invalidateQueries({
                queryKey: ["/api/meal-plans", planId],
              });
              break;
            case "pong":
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        // Reconnect after 3 seconds
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Connection failed, retry
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    }
  }, [planId, userId, enabled]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [connect]);

  return { isConnected, onlineUsers };
}
