import * as fs from 'fs';
import * as readline from 'readline';
import { CodeChunk } from './file-chunker';

export interface StreamingOptions {
  maxChunkSize?: number; // Maximum chunk size in bytes
  maxLines?: number; // Maximum lines per chunk
}

/**
 * Stream a large file and create chunks
 * @param filePath - Path to the file
 * @param language - Programming language
 * @param options - Streaming options
 * @returns Async generator of code chunks
 */
export async function* streamChunks(
  filePath: string,
  language: string,
  options: StreamingOptions = {}
): AsyncGenerator<CodeChunk> {
  const { maxChunkSize = 50000, maxLines = 1000 } = options;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentChunk: string[] = [];
  let currentSize = 0;
  let startLine = 1;
  let currentLine = 1;

  for await (const line of rl) {
    currentChunk.push(line);
    currentSize += line.length + 1; // +1 for newline
    currentLine++;

    // Check if we should emit a chunk
    if (currentSize >= maxChunkSize || currentChunk.length >= maxLines) {
      yield {
        type: 'file',
        path: filePath,
        language,
        code: currentChunk.join('\n'),
        startLine,
        endLine: currentLine - 1,
        metadata: {
          size: currentSize,
          lines: currentChunk.length,
        },
      };

      // Reset for next chunk
      currentChunk = [];
      currentSize = 0;
      startLine = currentLine;
    }
  }

  // Emit remaining chunk if any
  if (currentChunk.length > 0) {
    yield {
      type: 'file',
      path: filePath,
      language,
      code: currentChunk.join('\n'),
      startLine,
      endLine: currentLine - 1,
      metadata: {
        size: currentSize,
        lines: currentChunk.length,
      },
    };
  }
}
