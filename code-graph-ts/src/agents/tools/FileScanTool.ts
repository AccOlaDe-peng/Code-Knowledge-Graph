// FileScanTool — repository scanning and git incremental detection

import { createTool, type ToolResult } from './common.ts';
import type { Tool } from '../BaseAgent.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// Language detection by extension
const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.java': 'java', '.go': 'go', '.rs': 'rust',
  '.rb': 'ruby', '.php': 'php', '.cs': 'csharp', '.cpp': 'cpp',
  '.c': 'c', '.h': 'c', '.hpp': 'cpp', '.kt': 'kotlin',
  '.swift': 'swift', '.scala': 'scala', '.r': 'r', '.sql': 'sql',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json', '.xml': 'xml',
  '.md': 'markdown', '.html': 'html', '.css': 'css', '.scss': 'scss',
};

// Code file extensions (for pure-code ratio calculation)
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs',
  '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.hpp', '.kt',
  '.swift', '.scala', '.sql', '.sh',
]);

interface FileInfo {
  path: string;
  absolutePath: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isCodeFile: boolean;
  contentHash?: string;
}

interface ScanResult {
  rootPath: string;
  files: FileInfo[];
  totalFileCount: number;
  codeFileCount: number;
  codeFileRatio: number;
  languages: Record<string, number>;
  isPureCodeRepo: boolean;
}

function createFileScanTool(): Tool {
  return createTool<string, ScanResult>('FileScanTool', async (repoPath: string) => {
    const rootPath = path.resolve(repoPath);
    const files: FileInfo[] = [];
    const languageCounts: Record<string, number> = {};

    const scanDir = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden and common ignore directories
        if (entry.name.startsWith('.') || ['node_modules', '__pycache__', '.git', 'venv', '.venv', 'dist', 'build'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const language = EXTENSION_MAP[ext] ?? 'unknown';
          const isCodeFile = CODE_EXTENSIONS.has(ext);

          let sizeBytes = 0;
          let lineCount = 0;
          try {
            const stat = await fs.stat(fullPath);
            sizeBytes = stat.size;
            // Skip files > 1MB
            if (sizeBytes > 1024 * 1024) continue;
            const content = await fs.readFile(fullPath, 'utf-8');
            lineCount = content.split('\n').length;
          } catch {
            continue;
          }

          files.push({
            path: path.relative(rootPath, fullPath),
            absolutePath: fullPath,
            language,
            sizeBytes,
            lineCount,
            isCodeFile,
          });

          languageCounts[language] = (languageCounts[language] ?? 0) + 1;
        }
      }
    };

    await scanDir(rootPath);

    const codeFileCount = files.filter(f => f.isCodeFile).length;
    const totalFileCount = files.length;
    const codeFileRatio = totalFileCount > 0 ? codeFileCount / totalFileCount : 0;

    return {
      success: true,
      data: {
        rootPath,
        files,
        totalFileCount,
        codeFileCount,
        codeFileRatio,
        languages: languageCounts,
        isPureCodeRepo: codeFileRatio > 0.95,
      },
    };
  });
}

// Git diff detection
function createGitDiffTool(): Tool {
  return createTool<string, string[]>('GitDiffTool', async (repoPath: string) => {
    try {
      const proc = Bun.spawn(['git', 'diff', '--name-only', 'HEAD'], {
        cwd: repoPath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      return {
        success: true,
        data: stdout.trim().split('\n').filter(Boolean),
      };
    } catch {
      return { success: true, data: [] };
    }
  });
}

export type { FileInfo, ScanResult };
export { createFileScanTool, createGitDiffTool };
