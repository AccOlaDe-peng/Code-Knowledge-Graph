import * as fs from 'fs/promises';

export interface CodeChunk {
  type: 'file' | 'class' | 'function';
  path: string;
  language: string;
  code: string;
  startLine: number;
  endLine: number;
  metadata?: Record<string, any>;
}

/**
 * Create a file-level chunk from a source file
 * @param filePath - Path to the source file
 * @param language - Programming language
 * @returns Code chunk
 */
export async function chunkFile(filePath: string, language: string): Promise<CodeChunk> {
  const code = await fs.readFile(filePath, 'utf-8');
  const lines = code.split('\n');

  return {
    type: 'file',
    path: filePath,
    language,
    code,
    startLine: 1,
    endLine: lines.length,
    metadata: {
      size: code.length,
      lines: lines.length,
    },
  };
}

/**
 * Chunk multiple files
 * @param files - Array of file paths with languages
 * @returns Array of code chunks
 */
export async function chunkFiles(
  files: Array<{ path: string; language: string }>
): Promise<CodeChunk[]> {
  const chunks: CodeChunk[] = [];

  for (const file of files) {
    try {
      const chunk = await chunkFile(file.path, file.language);
      chunks.push(chunk);
    } catch (error) {
      console.error(`Error chunking file ${file.path}:`, error);
    }
  }

  return chunks;
}
