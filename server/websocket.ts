import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { storage } from "./storage";
import type { GroceryListUpdateMessage } from "@shared/schema";

type ListConnection = {
  ws: WebSocket;
  collaboratorId?: string;
  displayName: string;
  lastSeen: Date;
};

class GroceryListWebSocketManager {
  private wss: WebSocketServer | null = null;
  private listConnections: Map<string, Set<ListConnection>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws/grocery-list',
    });
    
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const displayName = url.searchParams.get("name") || "Guest";
      
      if (!token) {
        ws.close(4001, "Token required");
        return;
      }
      
      this.handleConnection(ws, token, displayName);
    });
    
    this.heartbeatInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 30000);
    
    console.log("[WebSocket] Grocery list WebSocket server initialized");
  }
  
  private async handleConnection(ws: WebSocket, token: string, displayName: string) {
    try {
      const share = await storage.getGroceryListShareByToken(token);
      if (!share) {
        ws.close(4004, "Invalid share token");
        return;
      }
      
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        ws.close(4010, "Share link expired");
        return;
      }
      
      const connection: ListConnection = {
        ws,
        displayName,
        lastSeen: new Date(),
      };
      
      if (!this.listConnections.has(token)) {
        this.listConnections.set(token, new Set());
      }
      
      this.listConnections.get(token)!.add(connection);
      
      this.broadcastToList(token, {
        type: 'collaborator_joined',
        collaborator: {
          id: '',
          shareId: share.id,
          userId: null,
          displayName,
          isActive: true,
          lastSeenAt: new Date(),
          joinedAt: new Date(),
        },
      });
      
      this.sendPresenceUpdate(token);
      
      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(token, connection, message);
        } catch (error) {
          console.error("[WebSocket] Error handling message:", error);
        }
      });
      
      ws.on("close", () => {
        this.listConnections.get(token)?.delete(connection);
        this.broadcastToList(token, {
          type: 'collaborator_left',
          collaboratorId: connection.collaboratorId || displayName,
        });
        this.sendPresenceUpdate(token);
      });
      
      ws.on("pong", () => {
        connection.lastSeen = new Date();
      });
      
      console.log(`[WebSocket] Client connected to list ${token.substring(0, 8)}... as ${displayName}`);
    } catch (error) {
      console.error("[WebSocket] Connection error:", error);
      ws.close(4500, "Internal error");
    }
  }
  
  private async handleMessage(token: string, connection: ListConnection, message: any) {
    connection.lastSeen = new Date();
    
    switch (message.type) {
      case 'toggle_item':
        try {
          const share = await storage.getGroceryListShareByToken(token);
          if (!share) {
            connection.ws.send(JSON.stringify({ type: 'error', message: 'Invalid share token' }));
            connection.ws.close(4004, 'Invalid share token');
            return;
          }
          
          if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
            connection.ws.send(JSON.stringify({ type: 'error', message: 'Share link expired' }));
            connection.ws.close(4010, 'Share link expired');
            return;
          }
          
          const itemBelongsToList = await storage.verifyItemBelongsToList(message.itemId, share.listId);
          if (!itemBelongsToList) {
            connection.ws.send(JSON.stringify({ type: 'error', message: 'Item not found in this list' }));
            return;
          }
          
          await storage.toggleSharedGroceryListItem(token, message.itemId, message.checked);
          this.broadcastToList(token, {
            type: 'item_checked',
            itemId: message.itemId,
            checked: message.checked,
            actorName: connection.displayName,
          });
        } catch (error) {
          console.error("[WebSocket] Error toggling item:", error);
          connection.ws.send(JSON.stringify({ type: 'error', message: 'Failed to toggle item' }));
        }
        break;
        
      case 'ping':
        connection.ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }
  
  broadcastToList(token: string, message: GroceryListUpdateMessage | { type: string; [key: string]: any }) {
    const connections = this.listConnections.get(token);
    if (!connections) return;
    
    const messageStr = JSON.stringify(message);
    
    Array.from(connections).forEach(conn => {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(messageStr);
      }
    });
  }
  
  revokeShareConnections(token: string) {
    const connections = this.listConnections.get(token);
    if (!connections) return;
    
    Array.from(connections).forEach(conn => {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ type: 'error', message: 'Share link has been revoked' }));
        conn.ws.close(4010, 'Share link revoked');
      }
    });
    
    this.listConnections.delete(token);
    console.log(`[WebSocket] Revoked all connections for token ${token.substring(0, 8)}...`);
  }
  
  private sendPresenceUpdate(token: string) {
    const connections = this.listConnections.get(token);
    if (!connections) return;
    
    const collaborators = Array.from(connections).map(conn => ({
      id: conn.collaboratorId || '',
      shareId: '',
      userId: null,
      displayName: conn.displayName,
      isActive: true,
      lastSeenAt: conn.lastSeen,
      joinedAt: conn.lastSeen,
    }));
    
    this.broadcastToList(token, {
      type: 'presence_update',
      collaborators,
    });
  }
  
  private async cleanupStaleConnections() {
    const staleThreshold = 60000;
    const now = Date.now();
    
    for (const [token, connections] of Array.from(this.listConnections.entries())) {
      const share = await storage.getGroceryListShareByToken(token);
      const isRevoked = !share || (share.expiresAt && new Date(share.expiresAt) < new Date());
      
      if (isRevoked) {
        Array.from(connections).forEach(conn => {
          if (conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({ type: 'error', message: 'Share link revoked or expired' }));
            conn.ws.close(4010, 'Share link revoked or expired');
          }
        });
        this.listConnections.delete(token);
        continue;
      }
      
      Array.from(connections).forEach(conn => {
        if (now - conn.lastSeen.getTime() > staleThreshold) {
          if (conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.ping();
          } else {
            connections.delete(conn);
          }
        }
      });
      
      if (connections.size === 0) {
        this.listConnections.delete(token);
      }
    }
  }
  
  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    Array.from(this.listConnections.values()).forEach(connections => {
      Array.from(connections).forEach(conn => {
        conn.ws.close(1001, "Server shutting down");
      });
    });
    
    this.wss?.close();
  }
}

export const groceryListWsManager = new GroceryListWebSocketManager();
