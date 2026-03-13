import * as fs from 'fs/promises';
import * as path from 'path';
import { detectLanguage } from './language-detector';

export interface ScannedFile {
  path: string;
  relativePath: string;
  language: string;
  size: number;
}

export interface ScanResult {
  files: ScannedFile[];
  repoInfo: {
    name: string;
    path: string;
    totalFiles: number;
    totalSize: number;
  };
}

// Directories to ignore during scanning
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.vscode',
  '.idea',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  'target',
  'bin',
  'obj',
  '__pycache__',
  '.pytest_cache',
  'venv',
  'env',
]);

// File extensions to ignore
const IGNORE_EXTENSIONS = new Set([
  '.lock',
  '.log',
  '.map',
  '.min.js',
  '.min.css',
]);

/**
 * Recursively scan a directory for source code files
 * @param dirPath - Directory path to scan
 * @param basePath - Base path for calculating relative paths
 * @param files - Accumulator for scanned files
 */
async function scanDirectory(
  dirPath: string,
  basePath: string,
  files: ScannedFile[]
): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (IGNORE_DIRS.has(entry.name)) {
          continue;
        }

        // Recursively scan subdirectory
        await scanDirectory(fullPath, basePath, files);
      } else if (entry.isFile()) {
        // Skip ignored file extensions
        const ext = path.extname(entry.name);
        if (IGNORE_EXTENSIONS.has(ext)) {
          continue;
        }

        // Detect language
        const language = detectLanguage(entry.name);
        if (!language) {
          continue; // Skip files with unknown language
        }

        // Get file stats
        const stats = await fs.stat(fullPath);
        const relativePath = path.relative(basePath, fullPath);

        files.push({
          path: fullPath,
          relativePath,
          language,
          size: stats.size,
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
}

/**
 * Scan a repository and collect all source code files
 * @param repoPath - Path to the repository
 * @returns Scan result with files and repository info
 */
export async function scanRepository(repoPath: string): Promise<ScanResult> {
  // Verify the path exists
  try {
    const stats = await fs.stat(repoPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${repoPath}`);
    }
  } catch (error) {
    throw new Error(`Invalid repository path: ${repoPath}`);
  }

  const files: ScannedFile[] = [];
  const startTime = Date.now();

  console.log(`Scanning repository: ${repoPath}`);

  // Scan the directory
  await scanDirectory(repoPath, repoPath, files);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const duration = Date.now() - startTime;

  console.log(`Scan complete: ${files.length} files (${(totalSize / 1024 / 1024).toFixed(2)} MB) in ${duration}ms`);

  return {
    files,
    repoInfo: {
      name: path.basename(repoPath),
      path: repoPath,
      totalFiles: files.length,
      totalSize,
    },
  };
}
