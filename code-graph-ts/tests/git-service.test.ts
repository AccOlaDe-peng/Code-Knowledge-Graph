import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitService } from '../src/services/git.service.js'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = join(import.meta.dirname, '__git_test_tmp__')

describe('GitService', () => {
  let service: GitService

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
    service = new GitService(join(TMP_DIR, 'repo-cache'))
  })

  it('本地路径已存在时直接返回', async () => {
    const localDir = join(TMP_DIR, 'my-local-repo')
    mkdirSync(localDir, { recursive: true })

    // Mock git method: non-git dir returns empty commit
    const gitSpy = vi.spyOn(service as any, 'git')
    gitSpy.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await service.prepareLocalPath(localDir)
    expect(result.localPath).toBe(localDir)
    expect(result.isClone).toBe(false)

    gitSpy.mockRestore()
  })

  it('本地路径不存在时当作 Git URL 处理', async () => {
    const gitSpy = vi.spyOn(service as any, 'git')
    gitSpy.mockRejectedValue(new Error('Command failed: git clone'))

    await expect(service.prepareLocalPath('https://github.com/nonexistent/repo.git'))
      .rejects.toThrow()

    gitSpy.mockRestore()
  })

  it('指定 branch 时对本地仓库执行 checkout', async () => {
    const localDir = join(TMP_DIR, 'git-repo')
    mkdirSync(localDir, { recursive: true })

    const gitSpy = vi.spyOn(service as any, 'git')
    gitSpy.mockImplementation((...args: string[]) => {
      if (args.includes('rev-parse')) return Promise.resolve({ stdout: 'abc123', stderr: '' })
      if (args.includes('checkout')) return Promise.resolve({ stdout: '', stderr: '' })
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await service.prepareLocalPath(localDir, 'dev')
    expect(result.localPath).toBe(localDir)
    expect(result.gitCommit).toBe('abc123')
    expect(result.isClone).toBe(false)

    gitSpy.mockRestore()
  })

  it('repo-cache 目录不存在时自动创建', () => {
    const cacheDir = join(TMP_DIR, 'new-cache')
    const svc = new GitService(cacheDir)
    expect(existsSync(cacheDir)).toBe(true)
  })
})
