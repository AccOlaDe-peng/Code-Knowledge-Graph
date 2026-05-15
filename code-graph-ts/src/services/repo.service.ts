import { RepoStore, type CreateRepoInput } from '../stores/repo-store.js'
import type { RepoInfo } from '../types/repo.js'

export class RepoService {
  constructor(private repoStore: RepoStore) {}

  listRepos(): RepoInfo[] {
    return this.repoStore.list()
  }

  getRepo(id: string): RepoInfo | undefined {
    return this.repoStore.get(id)
  }

  createRepo(input: CreateRepoInput): RepoInfo {
    return this.repoStore.create(input)
  }

  saveRepo(input: { id: string; name: string; path?: string; branch?: string; sourceMode?: string; languages?: string[] }): RepoInfo {
    const existing = this.repoStore.get(input.id)
    if (existing) {
      return this.repoStore.update(input.id, {
        name: input.name,
        path: input.path,
        branch: input.branch,
        sourceMode: input.sourceMode,
        languages: input.languages,
      })!
    }
    return this.repoStore.create({
      name: input.name,
      path: input.path,
      branch: input.branch,
      sourceMode: input.sourceMode,
      languages: input.languages,
    })
  }

  updateRepo(id: string, patch: Partial<Omit<RepoInfo, 'id' | 'createdAt'>>): RepoInfo | undefined {
    return this.repoStore.update(id, patch)
  }

  deleteRepo(id: string): void {
    this.repoStore.delete(id)
  }
}
