// SSE Broadcaster — Shared SSE notification utility for TaskQueue
// Note: The actual SSE endpoint is in analyze.ts

interface SSEClient {
  sessionId: string;
  reply: { raw: { write: (data: string) => boolean } };
  connected: boolean;
}

const clients = new Map<string, Set<SSEClient>>();

// Broadcast event to all clients for a session
function broadcast(sessionId: string, event: string, data: unknown): void {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of sessionClients) {
    if (client.connected) {
      try {
        client.reply.raw.write(message);
      } catch {
        client.connected = false;
        sessionClients.delete(client);
      }
    }
  }
}

// Register a client (called from analyze.ts SSE endpoint)
function registerClient(client: SSEClient): void {
  if (!clients.has(client.sessionId)) {
    clients.set(client.sessionId, new Set());
  }
  clients.get(client.sessionId)!.add(client);
}

// Unregister a client
function unregisterClient(client: SSEClient): void {
  clients.get(client.sessionId)?.delete(client);
}

// Cleanup stale connections
function cleanupStaleConnections(): void {
  for (const [sessionId, sessionClients] of clients) {
    for (const client of sessionClients) {
      if (!client.connected) {
        sessionClients.delete(client);
      }
    }

    if (sessionClients.size === 0) {
      clients.delete(sessionId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleConnections, 5 * 60 * 1000);

export { broadcast, registerClient, unregisterClient };
export type { SSEClient };
