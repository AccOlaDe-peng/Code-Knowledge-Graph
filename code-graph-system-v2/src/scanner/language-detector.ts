import * as path from 'path';

// Language detection based on file extension
const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',

  // Python
  '.py': 'python',
  '.pyw': 'python',

  // Java
  '.java': 'java',

  // Go
  '.go': 'go',

  // Rust
  '.rs': 'rust',

  // C/C++
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',

  // C#
  '.cs': 'csharp',

  // Ruby
  '.rb': 'ruby',

  // PHP
  '.php': 'php',

  // Swift
  '.swift': 'swift',

  // Kotlin
  '.kt': 'kotlin',
  '.kts': 'kotlin',

  // Scala
  '.scala': 'scala',

  // Shell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',

  // SQL
  '.sql': 'sql',

  // HTML/CSS
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',

  // Config files
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',

  // Markdown
  '.md': 'markdown',
  '.mdx': 'markdown',
};

/**
 * Detect programming language from file name
 * @param fileName - File name with extension
 * @returns Language name or null if unknown
 */
export function detectLanguage(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return LANGUAGE_MAP[ext] || null;
}

/**
 * Get all supported file extensions
 * @returns Array of supported extensions
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(LANGUAGE_MAP);
}

/**
 * Check if a file extension is supported
 * @param fileName - File name with extension
 * @returns True if supported, false otherwise
 */
export function isSupported(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext in LANGUAGE_MAP;
}
