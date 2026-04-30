// Filesystem routes — browse server paths for frontend

import type { FastifyPluginAsync } from 'fastify';
import { readdir, stat, access } from 'node:fs/promises';
import { resolve, basename, dirname, sep } from 'node:path';
import { homedir } from 'node:os';

const ALLOWED_PATHS: string[] = [];
const DENIED_PATHS = ['/etc/passwd', '/etc/shadow', '/root'];

function isPathAllowed(path: string): boolean {
  const normalized = resolve(path);

  // Block denied paths
  for (const denied of DENIED_PATHS) {
    if (normalized.startsWith(denied)) return false;
  }

  // Allow all if no whitelist configured
  if (ALLOWED_PATHS.length === 0) return true;

  // Check whitelist
  for (const allowed of ALLOWED_PATHS) {
    if (normalized.startsWith(allowed)) return true;
  }

  return false;
}

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'unknown';
  size?: number;
  modified?: string;
}

export const fsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/fs/home — get user home directory
  app.get('/fs/home', async () => {
    return { path: homedir() };
  });

  // GET /api/fs/list — list directory contents
  app.get<{ Querystring: { path?: string } }>('/fs/list', async (request, reply) => {
    const dirPath = request.query.path || homedir();
    const normalized = resolve(dirPath);

    if (!isPathAllowed(normalized)) {
      reply.code(403);
      return { detail: 'Path not allowed' };
    }

    try {
      await access(normalized);
    } catch {
      reply.code(404);
      return { detail: `Path not found: ${normalized}` };
    }

    try {
      const entries = await readdir(normalized, { withFileTypes: true });
      const result: DirEntry[] = [];

      for (const entry of entries) {
        // Skip hidden files
        if (entry.name.startsWith('.')) continue;

        const fullPath = resolve(normalized, entry.name);
        let type: DirEntry['type'] = 'unknown';
        let size: number | undefined;
        let modified: string | undefined;

        try {
          const stats = await stat(fullPath);
          type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'symlink';
          size = stats.size;
          modified = stats.mtime.toISOString();
        } catch {
          // Skip inaccessible entries
          continue;
        }

        // Only include directories for repo selection
        if (type === 'directory') {
          result.push({
            name: entry.name,
            path: fullPath,
            type,
            size,
            modified,
          });
        }
      }

      // Sort: directories first, then by name
      result.sort((a, b) => a.name.localeCompare(b.name));

      return {
        path: normalized,
        parent: dirname(normalized) !== normalized ? dirname(normalized) : null,
        entries: result,
      };
    } catch (error) {
      reply.code(500);
      return { detail: `Failed to read directory: ${error}` };
    }
  });

  // GET /api/fs/check — check if path exists and is a directory
  app.get<{ Querystring: { path: string } }>('/fs/check', async (request, reply) => {
    const { path } = request.query;
    const normalized = resolve(path);

    if (!isPathAllowed(normalized)) {
      reply.code(403);
      return { detail: 'Path not allowed' };
    }

    try {
      const stats = await stat(normalized);
      return {
        path: normalized,
        exists: true,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    } catch {
      return {
        path: normalized,
        exists: false,
        isDirectory: false,
        isFile: false,
      };
    }
  });

  // GET /api/fs/drives — list available drives (Windows) or common paths (Unix)
  app.get('/fs/drives', async () => {
    if (process.platform === 'win32') {
      // Windows: return common drives
      return {
        platform: 'win32',
        drives: ['C:\\', 'D:\\', 'E:\\'].filter(async (d) => {
          try {
            await access(d);
            return true;
          } catch {
            return false;
          }
        }),
      };
    } else {
      // Unix: return common paths
      return {
        platform: process.platform,
        drives: [
          { name: 'Home', path: homedir() },
          { name: 'Root', path: '/' },
          { name: 'Users', path: '/Users' },
          { name: 'tmp', path: '/tmp' },
        ],
      };
    }
  });
};

export default fsRoutes;
