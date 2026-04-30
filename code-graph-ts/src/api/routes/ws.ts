// WebSocket routes — real-time analysis notifications

import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { get, subscribe, unsubscribe } from '../sessions.ts';

export const wsRoutes: FastifyPluginAsync = async (app) => {
  // WebSocket /ws/analyze/:taskId — subscribe to analysis updates
  app.get<{ Params: { taskId: string } }>(
    '/ws/analyze/:taskId',
    { websocket: true },
    (socket: WebSocket, req) => {
      const { taskId } = req.params;

      // Heartbeat to keep connection alive
      let heartbeatInterval: ReturnType<typeof setInterval>;
      const startHeartbeat = () => {
        heartbeatInterval = setInterval(() => {
          if (socket.readyState === 1) {
            socket.ping();
          }
        }, 30000);
      };

      // Send current status immediately
      const sendStatus = () => {
        const session = get(taskId);
        if (session) {
          const progress = session.coordinator.getProgress();
          socket.send(JSON.stringify({
            type: 'status',
            data: {
              task_id: taskId,
              status: session.status,
              progress,
              node_count: session.result?.nodes.length ?? 0,
              edge_count: session.result?.edges.length ?? 0,
              error: session.error,
            },
          }));
        }
      };

      // Subscribe to updates
      const onStatusChange = (event: { taskId: string; status: string; data: unknown }) => {
        if (event.taskId === taskId) {
          socket.send(JSON.stringify({
            type: 'update',
            data: event.data,
          }));

          // Close connection on terminal state
          if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
            clearInterval(heartbeatInterval);
            socket.close(1000, 'Analysis finished');
          }
        }
      };

      subscribe(taskId, onStatusChange);
      startHeartbeat();
      sendStatus();

      // Handle incoming messages (optional ping/pong)
      socket.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore invalid messages
        }
      });

      // Cleanup on close
      socket.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe(taskId, onStatusChange);
      });

      socket.on('error', () => {
        clearInterval(heartbeatInterval);
        unsubscribe(taskId, onStatusChange);
      });
    }
  );

  // WebSocket /ws/status — global status stream (all analyses)
  app.get(
    '/ws/status',
    { websocket: true },
    (socket: WebSocket) => {
      let heartbeatInterval: ReturnType<typeof setInterval>;
      const startHeartbeat = () => {
        heartbeatInterval = setInterval(() => {
          if (socket.readyState === 1) {
            socket.ping();
          }
        }, 30000);
      };

      // Subscribe to all status changes
      const onStatusChange = (event: { taskId: string; status: string; data: unknown }) => {
        socket.send(JSON.stringify({
          type: 'status_update',
          data: event,
        }));
      };

      subscribe('*', onStatusChange);
      startHeartbeat();

      socket.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore invalid messages
        }
      });

      socket.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe('*', onStatusChange);
      });

      socket.on('error', () => {
        clearInterval(heartbeatInterval);
        unsubscribe('*', onStatusChange);
      });
    }
  );
};

export default wsRoutes;
