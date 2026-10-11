import { useEffect, useRef, useCallback, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { authToken, socketUrl } from "@/lib/platform";

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
  const stopped = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<{ userId: string; displayName: string }[]>([]);

  const connect = useCallback(async () => {
    if (!enabled || !planId || !userId) return;

    // The server works out who we are from sign-in: the cookie in a browser,
    // the session token (added here when there is one) in the app
    const params = new URLSearchParams({ planId });
    const token = await authToken();
    if (token) params.set("token", token);
    if (stopped.current) return;
    const wsUrl = socketUrl(`/ws/meal-plan?${params}`);

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

      ws.onclose = (event) => {
        setIsConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        // Reconnect after 3 seconds, unless we were turned away (not signed
        // in, or not on this plan) or the page is done with the socket
        if (enabled && !stopped.current && event.code !== 4401 && event.code !== 4003) {
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
    stopped.current = false;
    void connect();

    return () => {
      stopped.current = true;
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
