/**
 * WebSocket Client for Real-time Updates
 * ========================================
 * Replaces polling with WebSocket connections for real-time data
 */

import React from "react";

export type WebSocketMessage<T = unknown> = {
  type: "signal" | "device_update" | "heartbeat" | "snapshot";
  data: T;
  timestamp: number;
};

export type WebSocketEventHandler = (message: WebSocketMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private handlers: Set<WebSocketEventHandler> = new Set();
  private isIntentionallyClosed = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private missedPings = 0;

  constructor() {
    // Determine WebSocket URL based on environment
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = process.env.NEXT_PUBLIC_WS_URL || window.location.host;
    this.url = `${protocol}//${host}/ws`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isIntentionallyClosed = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected");
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit({
          type: "heartbeat",
          data: "connected",
          timestamp: Date.now(),
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          // Reset missed pings on any message
          if (message.type === "heartbeat") {
            this.missedPings = 0;
          }

          this.emit(message);
        } catch (error) {
          console.error("[WebSocket] Failed to parse message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
      };

      this.ws.onclose = (event) => {
        console.log("[WebSocket] Disconnected:", event.code, event.reason);
        this.stopHeartbeat();

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error("[WebSocket] Failed to connect:", error);
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        this.missedPings++;

        // Reconnect if we've missed too many pings
        if (this.missedPings > 3) {
          console.log("[WebSocket] Too many missed pings, reconnecting...");
          this.ws.close();
          this.scheduleReconnect();
        }
      }
    }, 30000); // Send ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.missedPings = 0;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[WebSocket] Max reconnection attempts reached");
      this.emit({
        type: "heartbeat",
        data: "disconnected",
        timestamp: Date.now(),
      });
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    console.log(`[WebSocket] Reconnecting in ${delay}ms...`);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[WebSocket] Cannot send, not connected");
    }
  }

  subscribe(handler: WebSocketEventHandler): () => void {
    this.handlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.delete(handler);
    };
  }

  private emit(message: WebSocketMessage): void {
    this.handlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error("[WebSocket] Handler error:", error);
      }
    });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    wsClient = new WebSocketClient();
  }
  return wsClient;
}

// React Hook for WebSocket
export function useWebSocket(
  handler: WebSocketEventHandler,
  deps: React.DependencyList = []
): WebSocketClient {
  const client = getWebSocketClient();

  React.useEffect(() => {
    const unsubscribe = client.subscribe(handler);
    client.connect();

    return () => {
      unsubscribe();
    };
  }, deps);

  return client;
}
