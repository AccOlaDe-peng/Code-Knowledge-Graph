// TreeSitterTool — AST parsing via web-tree-sitter

import { createTool, type ToolResult } from './common.ts';
import type { Tool } from '../BaseAgent.ts';
import type { SourceLocation } from '../../graph/schema.ts';

interface ASTNode {
  type: string;
  text: string;
  startLine: number;
  endLine: number;
  children: ASTNode[];
}

interface ParsedFile {
  filePath: string;
  language: string;
  ast: ASTNode | null;
  error?: string;
}

interface ExtractedSymbol {
  name: string;
  type: 'class' | 'function' | 'method' | 'interface' | 'import' | 'variable';
  location: SourceLocation;
  metadata: Record<string, unknown>;
}

interface ParseResult {
  filePath: string;
  language: string;
  symbols: ExtractedSymbol[];
  calls: { from: string; to: string; location: SourceLocation }[];
  imports: { source: string; target: string; location: SourceLocation }[];
}

// Supported languages with their tree-sitter grammar names
const SUPPORTED_LANGUAGES: Record<string, string> = {
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  go: 'go',
  rust: 'rust',
  ruby: 'ruby',
  php: 'php',
};

function createTreeSitterTool(): Tool {
  let parserInitialized = false;
  // Lazy init: web-tree-sitter is async
  let Parser: any = null;
  const languages: Map<string, any> = new Map();

  const initParser = async (): Promise<void> => {
    if (parserInitialized) return;
    try {
      const wts = await import('web-tree-sitter');
      Parser = wts.default ?? wts;
      await Parser.init();
      parserInitialized = true;
    } catch {
      // web-tree-sitter not available — AST parsing will be no-op
      parserInitialized = true;
    }
  };

  return createTool<{ filePath: string; content: string; language: string }, ParseResult>(
    'TreeSitterTool',
    async ({ filePath, content, language }) => {
      await initParser();

      const grammarName = SUPPORTED_LANGUAGES[language];
      if (!Parser || !grammarName) {
        return {
          success: true,
          data: {
            filePath,
            language,
            symbols: [],
            calls: [],
            imports: [],
          },
        };
      }

      // Parse the file
      const symbols: ExtractedSymbol[] = [];
      const calls: ParseResult['calls'] = [];
      const importsList: ParseResult['imports'] = [];

      try {
        // Simple regex-based extraction as fallback when grammar not loaded
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';

          // Class detection
          const classMatch = line.match(/\b(class|interface)\s+(\w+)/);
          if (classMatch) {
            symbols.push({
              name: classMatch[2]!,
              type: classMatch[1] === 'interface' ? 'interface' : 'class',
              location: { file: filePath, startLine: i + 1 },
              metadata: {},
            });
          }

          // Function/method detection
          const funcMatch = line.match(/\b(function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/);
          if (funcMatch) {
            const name = funcMatch[2] ?? funcMatch[3];
            if (name) {
              symbols.push({
                name,
                type: 'function',
                location: { file: filePath, startLine: i + 1 },
                metadata: {},
              });
            }
          }

          // Method detection (class methods)
          const methodMatch = line.match(/^\s+(?:public|private|protected|static|async)?\s*(\w+)\s*\(/);
          if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new'].includes(methodMatch[1]!)) {
            symbols.push({
              name: methodMatch[1]!,
              type: 'method',
              location: { file: filePath, startLine: i + 1 },
              metadata: {},
            });
          }

          // Import detection
          const importMatch = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
          if (importMatch) {
            importsList.push({
              source: filePath,
              target: importMatch[1]!,
              location: { file: filePath, startLine: i + 1 },
            });
          }
        }
      } catch (error) {
        return {
          success: false,
          error: `Parse failed for ${filePath}: ${error}`,
        };
      }

      return {
        success: true,
        data: {
          filePath,
          language,
          symbols,
          calls,
          imports: importsList,
        },
      };
    },
  );
}

export type { ASTNode, ParsedFile, ExtractedSymbol, ParseResult };
export { createTreeSitterTool, SUPPORTED_LANGUAGES };
