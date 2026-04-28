// RepoRegistry — Repository metadata registry (zero dependencies)
// Stores repo metadata at ~/.code-graph/repos.json

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.code-graph');

export interface RepoRecord {
  repoId: string;
  repoName: string;
  repoPath: string;
  branch?: string;
  sourceMode: 'local' | 'git' | 'zip';
  language: string[];
  createdAt: string;
  updatedAt: string;
}

interface RepoRegistryData {
  repos: Record<string, RepoRecord>;
}

class RepoRegistry {
  private baseDir: string;
  private data: RepoRegistryData | null = null;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
  }

  private get registryPath(): string {
    return path.join(this.baseDir, 'repos.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private loadRegistry(): RepoRegistryData {
    if (this.data) return this.data;

    try {
      const content = fs.readFileSync(this.registryPath, 'utf-8');
      this.data = JSON.parse(content) as RepoRegistryData;
      return this.data;
    } catch {
      this.data = { repos: {} };
      return this.data;
    }
  }

  private saveRegistry(): void {
    this.ensureDir();
    fs.writeFileSync(this.registryPath, JSON.stringify(this.data, null, 2));
  }

  save(repo: RepoRecord): void {
    const registry = this.loadRegistry();
    const now = new Date().toISOString();

    const existing = registry.repos[repo.repoId];
    if (existing) {
      registry.repos[repo.repoId] = {
        ...repo,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
    } else {
      registry.repos[repo.repoId] = {
        ...repo,
        createdAt: now,
        updatedAt: now,
      };
    }

    this.saveRegistry();
  }

  load(repoId: string): RepoRecord | null {
    const registry = this.loadRegistry();
    return registry.repos[repoId] ?? null;
  }

  list(): RepoRecord[] {
    const registry = this.loadRegistry();
    return Object.values(registry.repos).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  delete(repoId: string): boolean {
    const registry = this.loadRegistry();
    if (!registry.repos[repoId]) return false;

    delete registry.repos[repoId];
    this.saveRegistry();
    return true;
  }

  exists(repoId: string): boolean {
    const registry = this.loadRegistry();
    return repoId in registry.repos;
  }

  update(repoId: string, patch: Partial<Omit<RepoRecord, 'repoId' | 'createdAt'>>): RepoRecord | null {
    const existing = this.load(repoId);
    if (!existing) return null;

    const updated: RepoRecord = {
      ...existing,
      ...patch,
      repoId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.save(updated);
    return updated;
  }

  generateId(repoPath: string): string {
    const normalized = repoPath.replace(/\\/g, '/').replace(/\/$/, '');
    const last = normalized.split('/').pop() || normalized;
    const safeName = last.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safeName}_${Date.now().toString(36)}`;
  }
}

export { RepoRegistry, DEFAULT_BASE_DIR };
