import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RepoStore } from '../src/stores/repo-store.js'
import type { RepoInfo } from '../src/types/repo.js'

describe('RepoStore', () => {
  let store: RepoStore
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'repo-store-test-'))
    store = new RepoStore(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('初始时列出空列表', () => {
    expect(store.list()).toEqual([])
  })

  it('创建并获取仓库', () => {
    const repo = store.create({ name: 'test-repo', path: '/tmp/repo', sourceMode: 'local' })
    expect(repo.name).toBe('test-repo')
    expect(store.get(repo.id)).toBeDefined()
    expect(store.get(repo.id)!.name).toBe('test-repo')
  })

  it('创建仓库时自动生成 id 和时间戳', () => {
    const repo = store.create({ name: 'test' })
    expect(repo.id).toBeTruthy()
    expect(repo.createdAt).toBeTruthy()
    expect(repo.updatedAt).toBeTruthy()
  })

  it('列出所有仓库', () => {
    store.create({ name: 'a' })
    store.create({ name: 'b' })
    expect(store.list()).toHaveLength(2)
  })

  it('删除仓库', () => {
    const repo = store.create({ name: 'to-delete' })
    store.delete(repo.id)
    expect(store.get(repo.id)).toBeUndefined()
  })

  it('删除不存在的仓库不报错', () => {
    expect(() => store.delete('non-existent')).not.toThrow()
  })

  it('更新仓库', () => {
    const repo = store.create({ name: 'original' })
    store.update(repo.id, { name: 'updated', languages: ['typescript'] })
    const updated = store.get(repo.id)!
    expect(updated.name).toBe('updated')
    expect(updated.languages).toEqual(['typescript'])
  })

  it('持久化到文件，重启后恢复', () => {
    const repo = store.create({ name: 'persistent' })
    const store2 = new RepoStore(tempDir)
    expect(store2.get(repo.id)).toBeDefined()
    expect(store2.get(repo.id)!.name).toBe('persistent')
  })
})
