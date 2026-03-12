import type { LayoutNodeInput, LayoutEdgeInput, DagreConfig, LayoutResult } from './types'

// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum number of layout results held in cache simultaneously. */
const MAX_CACHE_SIZE = 20

// ─── FNV-32a Hash ─────────────────────────────────────────────────────────────
// Lightweight non-cryptographic hash — acceptable collision rate for a cache key.

function fnv32a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    // Unsigned 32-bit multiply — >>> 0 coerces to uint32
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// ─── Cache Entry ──────────────────────────────────────────────────────────────

type CacheEntry = {
  /**
   * WeakRef allows the GC to reclaim the LayoutResult when the heap is under
   * pressure. A deref() that returns undefined means the entry is stale.
   */
  ref:       WeakRef<LayoutResult>
  /** Unix timestamp (ms) of when the entry was last written. */
  updatedAt: number
  /**
   * Monotonically increasing counter. Used for LRU eviction:
   * entry with the smallest lruOrder is evicted when cache is full.
   */
  lruOrder:  number
}

// ─── LayoutCache ──────────────────────────────────────────────────────────────

/**
 * Topology-keyed cache for layout results.
 *
 * Key: FNV-32a hash of (sorted node ids) + (sorted edge signatures) + config.
 *      This means cache hits require the exact same graph topology AND config,
 *      regardless of node label / property changes.
 *
 * Storage: values are held via WeakRef so the GC can evict them under memory
 *          pressure without us needing to explicitly track heap usage.
 *
 * Eviction: when size > MAX_CACHE_SIZE, the LRU entry is evicted.
 */
export class LayoutCache {
  private readonly entries = new Map<string, CacheEntry>()
  private lruCounter = 0

  // ── Public API ─────────────────────────────────────────────────────────────

  get(key: string): LayoutResult | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    const result = entry.ref.deref()
    if (!result) {
      // GC has reclaimed the value — remove the stale entry
      this.entries.delete(key)
      return null
    }

    // Bump LRU order on hit
    entry.lruOrder = ++this.lruCounter
    return result
  }

  set(key: string, result: LayoutResult): void {
    if (this.entries.size >= MAX_CACHE_SIZE) {
      this.evictLRU()
    }

    this.entries.set(key, {
      ref:       new WeakRef(result),
      updatedAt: Date.now(),
      lruOrder:  ++this.lruCounter,
    })
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  /** Remove a specific entry by key. */
  invalidate(key: string): void {
    this.entries.delete(key)
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.clear()
    this.lruCounter = 0
  }

  get size(): number {
    return this.entries.size
  }

  // ── Key Builder ────────────────────────────────────────────────────────────

  /**
   * Build a stable cache key from graph topology + config.
   *
   * Only node IDs, edge source→target pairs, and config values contribute
   * to the key — not node labels, properties, or dimensions.
   * This means the same topology always hits the cache even after a label update.
   */
  buildKey(
    nodes:  LayoutNodeInput[],
    edges:  LayoutEdgeInput[],
    config: DagreConfig,
  ): string {
    // Sort to make key order-independent
    const nodeFragment = nodes
      .map(n => n.id)
      .sort()
      .join('|')

    const edgeFragment = edges
      .map(e => `${e.source}→${e.target}`)
      .sort()
      .join('|')

    const configFragment = [
      config.rankdir,
      config.ranksep,
      config.nodesep,
      config.edgesep,
      config.marginx,
      config.marginy,
      config.align ?? '',
    ].join(',')

    const raw = `${nodeFragment}@@${edgeFragment}@@${configFragment}`
    return fnv32a(raw).toString(16)
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private evictLRU(): void {
    let minOrder = Infinity
    let lruKey:   string | null = null

    for (const [key, entry] of this.entries) {
      if (entry.lruOrder < minOrder) {
        minOrder = entry.lruOrder
        lruKey   = key
      }
    }

    if (lruKey !== null) {
      this.entries.delete(lruKey)
    }
  }
}
