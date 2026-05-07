// Structured logger — console + file output with request/response capture

import pino from 'pino';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Writable } from 'node:stream';

const LOG_DIR = resolve(import.meta.dir, '../../logs');

// Ensure log directory exists
try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const isDev = process.env.NODE_ENV !== 'production';

// File write stream (raw JSON)
const fileStream = new Writable({
  write(chunk, _encoding, callback) {
    const line = chunk.toString().trim();
    if (!line) { callback(); return; }
    try {
      const parsed = JSON.parse(line);
      // Human-readable file format: [TIME] LEVEL: message {extra}
      const time = new Date(parsed.time).toISOString();
      const level = pino.levels.labels[parsed.level] ?? 'info';
      const msg = parsed.msg ?? '';
      const extra = Object.keys(parsed)
        .filter(k => !['level', 'time', 'pid', 'hostname', 'msg'].includes(k))
        .length > 0
        ? ' ' + JSON.stringify(
            Object.fromEntries(
              Object.entries(parsed).filter(([k]) => !['level', 'time', 'pid', 'hostname', 'msg'].includes(k))
            )
          )
        : '';
      // Append to daily log file
      const dateStr = new Date().toISOString().slice(0, 10);
      const fs = require('node:fs');
      fs.appendFileSync(resolve(LOG_DIR, `server-${dateStr}.log`), `[${time}] ${level.toUpperCase()}: ${msg}${extra}\n`);
    } catch {
      const fs = require('node:fs');
      fs.appendFileSync(resolve(LOG_DIR, `server-${new Date().toISOString().slice(0, 10)}.log`), `${chunk.toString().trim()}\n`);
    }
    callback();
  },
});

// Multi-stream: console (pretty in dev) + file (JSON)
const streams: pino.StreamEntry[] = [
  // File stream
  { stream: fileStream },
];

if (isDev) {
  streams.push({
    stream: pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    }),
  });
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  },
  pino.multistream(streams),
);

// ── HTTP Request/Response Logger ────────────────────────────

const MAX_BODY_LOG = 2000; // Truncate bodies longer than this

function truncate(obj: unknown): unknown {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  if (str.length <= MAX_BODY_LOG) return obj;
  return str.slice(0, MAX_BODY_LOG) + `...[truncated, total ${str.length} chars]`;
}

function redactSensitive(headers: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...headers };
  for (const key of ['authorization', 'cookie', 'x-api-key']) {
    if (redacted[key]) redacted[key] = '***';
  }
  return redacted;
}

export interface RequestLog {
  method: string;
  url: string;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
}

export interface ResponseLog {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  body?: unknown;
  contentLength?: number;
}

export function logRequest(req: RequestLog): void {
  logger.info(
    {
      request: {
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        body: req.body ? truncate(req.body) : undefined,
        ip: req.ip,
      },
    },
    `→ ${req.method} ${req.url}`,
  );
}

export function logResponse(res: ResponseLog): void {
  const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
  logger[level](
    {
      response: {
        method: res.method,
        url: res.url,
        statusCode: res.statusCode,
        durationMs: res.durationMs,
        contentLength: res.contentLength,
        body: res.body ? truncate(res.body) : undefined,
      },
    },
    `← ${res.statusCode} ${res.method} ${res.url} (${res.durationMs}ms)`,
  );
}

export function logAnalysis(sessionId: string, stage: string, detail?: Record<string, unknown>): void {
  logger.info({ sessionId, stage, ...detail }, `📊 [${sessionId}] ${stage}`);
}

export function logError(sessionId: string, error: Error, context?: Record<string, unknown>): void {
  logger.error(
    { sessionId, error: error.message, stack: error.stack, ...context },
    `❌ [${sessionId}] ${error.message}`,
  );
}
