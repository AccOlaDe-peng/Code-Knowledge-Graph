import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitPrepareResult {
  localPath: string
  gitCommit: string
  isClone: boolean
}

export class GitError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message)
    this.name = 'GitError'
  }
}

export class GitService {
  private repoCacheDir: string

  constructor(repoCacheDir: string) {
    this.repoCacheDir = repoCacheDir
    mkdirSync(repoCacheDir, { recursive: true })
  }

  async prepareLocalPath(repoPath: string, branch?: string): Promise<GitPrepareResult> {
    if (existsSync(repoPath)) {
      return this.prepareLocalRepo(repoPath, branch)
    }
    return this.cloneRemoteRepo(repoPath, branch)
  }

  private async prepareLocalRepo(localPath: string, branch?: string): Promise<GitPrepareResult> {
    if (branch) {
      await this.git(localPath, 'checkout', branch).catch(() => {})
    }
    const gitCommit = await this.getHeadCommit(localPath)
    return { localPath, gitCommit, isClone: false }
  }

  private async cloneRemoteRepo(url: string, branch?: string): Promise<GitPrepareResult> {
    const repoName = this.extractRepoName(url)
    const cachePath = join(this.repoCacheDir, repoName)

    if (existsSync(join(cachePath, '.git'))) {
      await this.git(cachePath, 'fetch', '--all')
      if (branch) {
        await this.git(cachePath, 'checkout', branch).catch(async () => {
          await this.git(cachePath, 'checkout', 'main').catch(() => this.git(cachePath, 'checkout', 'master'))
        })
      }
      await this.git(cachePath, 'pull').catch(() => {})
    } else {
      const args = ['clone', url, cachePath]
      if (branch) args.splice(1, 0, '-b', branch)
      try {
        await this.git('', ...args)
      } catch (primaryErr) {
        if (branch) {
          const argsMain = ['clone', '-b', 'main', url, cachePath]
          try {
            await this.git('', ...argsMain)
          } catch {
            const argsMaster = ['clone', '-b', 'master', url, cachePath]
            await this.git('', ...argsMaster)
          }
        } else {
          throw primaryErr
        }
      }
    }

    const gitCommit = await this.getHeadCommit(cachePath)
    return { localPath: cachePath, gitCommit, isClone: true }
  }

  private async getHeadCommit(repoPath: string): Promise<string> {
    try {
      const { stdout } = await this.git(repoPath, 'rev-parse', 'HEAD')
      return stdout.trim()
    } catch {
      return ''
    }
  }

  private git(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
    const opts = cwd ? { cwd } : {}
    return execFileAsync('git', args, opts)
  }

  private extractRepoName(url: string): string {
    const base = basename(url)
    return base.endsWith('.git') ? base.slice(0, -4) : base
  }
}
