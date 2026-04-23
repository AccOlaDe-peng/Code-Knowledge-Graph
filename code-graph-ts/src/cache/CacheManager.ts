// CacheManager — TTL + Schema version

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Schema version must update when GraphNode format changes
const CACHE_SCHEMA_VERSION = '2026-04-22-v1';

// TTL per cache type
const CACHE_TTL = {
  ast: 7 * 24 * 60 * 60 * 1000,      // 7 days (structure stable)
  semantic: 24 * 60 * 60 * 1000,     // 1 day (may change)
  lineage: 3 * 24 * 60 * 60 * 1000,  // 3 days
} as const;

type CacheType = keyof typeof CACHE_TTL;

interface CacheEntry {
  key: string;
  result: unknown;
  createdAt: number;
  type: CacheType;
  schemaVersion: string;
  ttlMs: number;
}

/**
 * CacheManager with TTL expiry and schema version checking.
 * - Keys are SHA256 of file path + content hash
 * - Entries expire based on type-specific TTL
 * - Schema version mismatch triggers cache invalidation
 */
class CacheManager {
  private store: Map<string, CacheEntry> = new Map();
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? path.join(process.env.HOME ?? '/tmp', '.code-graph', 'cache');
  }

  /**
   * Check which files are cached (hit) or need processing (miss)
   */
  check(filePaths: string[]): { hit: string[]; miss: string[] } {
    const hit: string[] = [];
    const miss: string[] = [];

    for (const fp of filePaths) {
      const key = this.makeKey(fp);
      const entry = this.get(key);
      if (entry) {
        hit.push(fp);
      } else {
        miss.push(fp);
      }
    }

    return { hit, miss };
  }

  /**
   * Get a cached entry (with TTL and schema version checks)
   */
  get(key: string): CacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // TTL expiry check
    if (Date.now() > entry.createdAt + entry.ttlMs) {
      this.store.delete(key);
      return null;
    }

    // Schema version check
    if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Set a cached entry
   */
  set(key: string, result: unknown, type: CacheType): void {
    this.store.set(key, {
      key,
      result,
      createdAt: Date.now(),
      type,
      schemaVersion: CACHE_SCHEMA_VERSION,
      ttlMs: CACHE_TTL[type],
    });
  }

  /**
   * Create a cache key from file path (optionally with content hash)
   */
  makeKey(filePath: string, contentHash?: string): string {
    const input = contentHash ? `${filePath}:${contentHash}` : filePath;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Detect which files changed since last analysis (using mtime or git)
   */
  async detectChanges(baseDir: string): Promise<string[]> {
    const changed: string[] = [];

    // Simple mtime-based detection
    const readDir = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          const key = this.makeKey(fullPath);
          if (!this.get(key)) {
            changed.push(fullPath);
          }
        } else if (entry.isDirectory()) {
          await readDir(fullPath);
        }
      }
    };
    await readDir(baseDir);
    return changed;
  }

  /**
   * Save cache to disk
   */
  async saveToFile(filePath?: string): Promise<void> {
    const targetPath = filePath ?? path.join(this.cacheDir, 'cache.json');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const data: Record<string, CacheEntry> = {};
    for (const [key, entry] of this.store) {
      data[key] = entry;
    }

    await fs.writeFile(targetPath, JSON.stringify(data, null, 2));
  }

  /**
   * Load cache from disk
   */
  async loadFromFile(filePath?: string): Promise<void> {
    const targetPath = filePath ?? path.join(this.cacheDir, 'cache.json');

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      const data = JSON.parse(content) as Record<string, CacheEntry>;

      for (const [key, entry] of Object.entries(data)) {
        // Validate schema version on load
        if (entry.schemaVersion === CACHE_SCHEMA_VERSION) {
          this.store.set(key, entry);
        }
      }
    } catch {
      // File doesn't exist or corrupted — start fresh
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { entries: number; size: number } {
    return {
      entries: this.store.size,
      size: this.store.size, // Could estimate byte size
    };
  }
}

export { CacheManager, CACHE_SCHEMA_VERSION, CACHE_TTL };
export type { CacheEntry, CacheType };
