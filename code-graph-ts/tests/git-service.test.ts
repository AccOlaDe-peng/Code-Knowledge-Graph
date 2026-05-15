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

  it('缓存已存在时执行 fetch + checkout + pull', async () => {
    const cacheDir = join(TMP_DIR, 'repo-cache')
    const cachedRepo = join(cacheDir, 'myrepo')
    mkdirSync(join(cachedRepo, '.git'), { recursive: true })

    const gitSpy = vi.spyOn(service as any, 'git')
    gitSpy.mockImplementation((...args: string[]) => {
      if (args.includes('fetch')) return Promise.resolve({ stdout: '', stderr: '' })
      if (args.includes('checkout')) return Promise.resolve({ stdout: '', stderr: '' })
      if (args.includes('pull')) return Promise.resolve({ stdout: '', stderr: '' })
      if (args.includes('rev-parse')) return Promise.resolve({ stdout: 'def456', stderr: '' })
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await service.prepareLocalPath('https://example.com/myrepo.git', 'dev')
    expect(result.localPath).toBe(cachedRepo)
    expect(result.isClone).toBe(true)
    expect(result.gitCommit).toBe('def456')
    expect(gitSpy).toHaveBeenCalledWith(expect.any(String), 'fetch', '--all')

    gitSpy.mockRestore()
  })

  it('extractRepoName 去掉 .git 后缀', async () => {
    const gitSpy = vi.spyOn(service as any, 'git')
    gitSpy.mockRejectedValue(new Error('fail'))

    await service.prepareLocalPath('https://github.com/org/my-project.git').catch(() => {})
    expect(gitSpy).toHaveBeenCalledWith('', 'clone', 'https://github.com/org/my-project.git', expect.stringContaining('my-project'))

    gitSpy.mockRestore()
  })

  it('clone 失败时 branch fallback 到 main 再到 master', async () => {
    const gitSpy = vi.spyOn(service as any, 'git')
    const callLog: string[][] = []
    gitSpy.mockImplementation((...args: string[]) => {
      callLog.push(args)
      if (args[0] === '' && args[1] === 'clone') {
        if (args[2] === '-b' && args[3] === 'dev') return Promise.reject(new Error('branch dev not found'))
        if (args[2] === '-b' && args[3] === 'main') return Promise.resolve({ stdout: '', stderr: '' })
        return Promise.reject(new Error('fail'))
      }
      if (args.includes('rev-parse')) return Promise.resolve({ stdout: 'ghi789', stderr: '' })
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await service.prepareLocalPath('https://example.com/fallback-repo', 'dev')
    expect(result.isClone).toBe(true)
    const cloneCalls = callLog.filter(c => c[1] === 'clone')
    expect(cloneCalls.length).toBeGreaterThanOrEqual(2)
    expect(cloneCalls[0][3]).toBe('dev')
    expect(cloneCalls[1][3]).toBe('main')

    gitSpy.mockRestore()
  })

  it('git 命令失败时抛出 GitError', async () => {
    const gitSpy = vi.spyOn(service as any, 'git')
    gitSpy.mockRejectedValue(new Error('git clone failed'))

    await expect(service.prepareLocalPath('https://example.com/err-repo'))
      .rejects.toThrow('git clone')

    gitSpy.mockRestore()
  })
})
