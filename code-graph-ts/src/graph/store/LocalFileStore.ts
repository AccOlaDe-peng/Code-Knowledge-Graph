// LocalFileStore — JSON file-based graph storage (zero dependencies)
// Stores graphs at ~/.code-graph/graphs/{sessionId}.json

import type { GraphData, GraphNode, GraphEdge } from '../../graph/schema.ts';
import { validateGraph } from '../../graph/schema.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.code-graph');

interface StoreMetadata {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
}

interface StoredGraph extends GraphData {
  _meta: StoreMetadata;
}

class LocalFileStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
  }

  private get graphsDir(): string {
    return path.join(this.baseDir, 'graphs');
  }

  private getFilePath(sessionId: string): string {
    return path.join(this.graphsDir, `${sessionId}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.graphsDir)) {
      fs.mkdirSync(this.graphsDir, { recursive: true });
    }
  }

  async save(sessionId: string, data: GraphData): Promise<void> {
    this.ensureDir();

    const now = new Date().toISOString();
    const stored: StoredGraph = {
      ...data,
      _meta: {
        sessionId,
        createdAt: now,
        updatedAt: now,
        nodeCount: data.nodes.length,
        edgeCount: data.edges.length,
      },
    };

    const filePath = this.getFilePath(sessionId);
    await fs.promises.writeFile(filePath, JSON.stringify(stored, null, 2));
  }

  async load(sessionId: string): Promise<GraphData | null> {
    const filePath = this.getFilePath(sessionId);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const stored = JSON.parse(content) as StoredGraph;

      return {
        nodes: stored.nodes,
        edges: stored.edges,
      };
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    const filePath = this.getFilePath(sessionId);

    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async exists(sessionId: string): Promise<boolean> {
    const filePath = this.getFilePath(sessionId);
    return fs.existsSync(filePath);
  }

  async getMetadata(sessionId: string): Promise<StoreMetadata | null> {
    const filePath = this.getFilePath(sessionId);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const stored = JSON.parse(content) as StoredGraph;
      return stored._meta ?? null;
    } catch {
      return null;
    }
  }

  async listSessions(): Promise<Array<{ sessionId: string; meta: StoreMetadata }>> {
    this.ensureDir();

    try {
      const files = await fs.promises.readdir(this.graphsDir);
      const sessions: Array<{ sessionId: string; meta: StoreMetadata }> = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const sessionId = file.replace('.json', '');
        const meta = await this.getMetadata(sessionId);
        if (meta) {
          sessions.push({ sessionId, meta });
        }
      }

      return sessions.sort((a, b) =>
        b.meta.updatedAt.localeCompare(a.meta.updatedAt)
      );
    } catch {
      return [];
    }
  }

  async update(sessionId: string, data: Partial<GraphData>): Promise<boolean> {
    const existing = await this.load(sessionId);
    if (!existing) return false;

    const merged: GraphData = {
      nodes: data.nodes ?? existing.nodes,
      edges: data.edges ?? existing.edges,
    };

    await this.save(sessionId, merged);
    return true;
  }

  async addNodes(sessionId: string, nodes: GraphNode[]): Promise<boolean> {
    const existing = await this.load(sessionId);
    if (!existing) return false;

    const existingIds = new Set(existing.nodes.map(n => n.id));
    const newNodes = nodes.filter(n => !existingIds.has(n.id));

    existing.nodes.push(...newNodes);
    await this.save(sessionId, existing);
    return true;
  }

  async addEdges(sessionId: string, edges: GraphEdge[]): Promise<boolean> {
    const existing = await this.load(sessionId);
    if (!existing) return false;

    existing.edges.push(...edges);
    await this.save(sessionId, existing);
    return true;
  }

  async validate(sessionId: string): Promise<{ valid: boolean; errors: string[] }> {
    const data = await this.load(sessionId);
    if (!data) {
      return { valid: false, errors: ['Session not found'] };
    }

    const result = validateGraph(data);
    return {
      valid: result.valid,
      errors: result.errors.map(e => `${e.location}: ${e.message}`),
    };
  }
}

export { LocalFileStore, DEFAULT_BASE_DIR };
export type { StoreMetadata, StoredGraph };
