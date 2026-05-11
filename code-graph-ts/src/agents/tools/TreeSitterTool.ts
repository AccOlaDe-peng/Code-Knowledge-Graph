// TreeSitterTool — AST parsing and data flow extraction via web-tree-sitter

import { createTool, type ToolResult } from './common.ts';
import type { Tool } from '../BaseAgent.ts';
import type { SourceLocation } from '../../graph/schema.ts';
import {
  DataFlowType,
  Confidence,
  AMBIGUOUS_PATTERNS,
  MAX_FILE_SIZE,
} from '../../graph/schema.ts';
import type { DataFlowEdge, DataFlowLocation } from '../../graph/schema.ts';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────

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
  dataFlowEdges?: DataFlowEdge[];
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

// Language WASM file paths
const LANGUAGE_WASM_PATHS: Record<string, string[]> = {
  java: ['tree-sitter-java/tree-sitter-java.wasm', 'tree-sitter-java/dist/tree-sitter-java.wasm'],
  typescript: ['tree-sitter-typescript/tree-sitter-typescript.wasm', 'tree-sitter-typescript/dist/tree-sitter-typescript.wasm'],
  tsx: ['tree-sitter-typescript/tree-sitter-typescript.wasm', 'tree-sitter-typescript/dist/tree-sitter-typescript.wasm'],
  javascript: ['tree-sitter-javascript/tree-sitter-javascript.wasm'],
  python: ['tree-sitter-python/tree-sitter-python.wasm'],
  go: ['tree-sitter-go/tree-sitter-go.wasm'],
};

// Data flow query patterns for Java
const JAVA_DATA_FLOW_QUERIES = [
  // Assignment: UserDTO dto = userRepo.findById(id);
  `(assignment_expression
    left: (identifier) @target
    right: (method_invocation
      object: (identifier) @source
      name: (identifier) @method)) @assignment`,
  // Method call argument: service.process(data)
  `(method_invocation
    object: (identifier) @source
    name: (identifier) @method
    arguments: (argument_list (identifier) @arg)) @call_arg`,
  // Return: return result;
  `(return_statement
    (identifier) @retval) @return`,
  // Repository read: repo.findById(id)
  `(method_invocation
    object: (identifier) @repo
    name: (identifier) @method
    (#match? @method "^(findById|findAll|getById|get|findOne|query|select)")) @db_read`,
  // Repository write: repo.save(entity)
  `(method_invocation
    object: (identifier) @repo
    name: (identifier) @method
    (#match? @method "^(save|saveAll|insert|create|update|delete)")) @db_write`,
];

// Data flow query patterns for TypeScript
const TS_DATA_FLOW_QUERIES = [
  // Assignment: const user = await fetchUser(id);
  `(variable_declarator
    name: (identifier) @target
    value: (await_expression
      (call_expression
        function: (identifier) @source))) @assignment`,
  // Method call: this.userRepo.findById(id)
  `(call_expression
    function: (member_expression
      object: (this) @source
      property: (identifier) @method)
    arguments: (arguments (identifier) @arg)) @call_arg`,
  // Return: return result
  `(return_statement
    (identifier) @retval) @return`,
];

// ── Lazy Parser Initialization ─────────────────────────────

let parserInitialized = false;
let wts: any = null;
let Parser: any = null;
let Query: any = null;
let Language: any = null;
const languages: Map<string, any> = new Map();
const initPromise: Promise<void> | null = null;

async function initParser(): Promise<void> {
  if (parserInitialized) return;

  try {
    wts = await import('web-tree-sitter');
    Parser = wts.Parser;
    Query = wts.Query;
    Language = wts.Language;

    // Must call init() before creating Parser instances
    await Parser.init();
    parserInitialized = true;
  } catch {
    // web-tree-sitter not available — will use regex fallback
    parserInitialized = true;
  }
}

async function loadLanguage(langName: string): Promise<any> {
  if (languages.has(langName)) {
    return languages.get(langName)!;
  }

  const wasmPaths = LANGUAGE_WASM_PATHS[langName];
  if (!wasmPaths) return null;

  for (const wasmPath of wasmPaths) {
    const fullPath = path.resolve('node_modules', wasmPath);
    if (fs.existsSync(fullPath)) {
      try {
        const wasmBuffer = fs.readFileSync(fullPath);
        const lang = await Language.load(wasmBuffer);
        languages.set(langName, lang);
        return lang;
      } catch {
        // Try next path
      }
    }
  }

  return null;
}

// ── Tool Creation ──────────────────────────────────────────

function createTreeSitterTool(): Tool {
  return createTool<{ filePath: string; content: string; language: string }, ParseResult>(
    'TreeSitterTool',
    async ({ filePath, content, language }) => {
      await initParser();

      const symbols: ExtractedSymbol[] = [];
      const calls: ParseResult['calls'] = [];
      const importsList: ParseResult['imports'] = [];
      const dataFlowEdges: DataFlowEdge[] = [];

      // Check file size
      if (content.length > MAX_FILE_SIZE) {
        return {
          success: true,
          data: {
            filePath,
            language,
            symbols: [],
            calls: [],
            imports: [],
            dataFlowEdges: [],
          },
          warning: `File too large (${Math.round(content.length / 1024)}KB), skipped`,
        };
      }

      const grammarName = SUPPORTED_LANGUAGES[language];
      if (!grammarName) {
        return {
          success: true,
          data: { filePath, language, symbols: [], calls: [], imports: [] },
        };
      }

      // Try real Tree-sitter parsing first
      if (Parser) {
        try {
          const lang = await loadLanguage(grammarName);
          if (lang) {
            const parser = new Parser();
            parser.setLanguage(lang);
            const tree = parser.parse(content);
            const root = tree.rootNode;

            // Extract symbols from AST
            extractSymbolsFromAST(root, filePath, symbols);

            // Extract imports
            extractImportsFromAST(root, filePath, importsList);

            // Extract data flow edges
            if (grammarName === 'java') {
              extractDataFlowJava(root, lang, filePath, dataFlowEdges);
            } else if (grammarName === 'typescript' || grammarName === 'tsx') {
              extractDataFlowTS(root, lang, filePath, dataFlowEdges);
            }

            return {
              success: true,
              data: { filePath, language, symbols, calls, imports: importsList, dataFlowEdges },
            };
          }
        } catch (error) {
          // Fall through to regex fallback
        }
      }

      // Regex fallback when Tree-sitter not available
      try {
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

          // Method detection
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
          } else {
            // Java-style import: import java.util.List;
            const javaImportMatch = line.match(/^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/);
            if (javaImportMatch) {
              importsList.push({
                source: filePath,
                target: javaImportMatch[2]!,
                location: { file: filePath, startLine: i + 1 },
              });
            }
          }
        }
      } catch (error) {
        return {
          success: false,
          error: `Parse failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      return {
        success: true,
        data: { filePath, language, symbols, calls, imports: importsList },
      };
    },
  );
}

// ── Annotation & DocComment Extraction ─────────────────────

/**
 * 提取 Java 注解（如 @Service, @Controller）
 */
function extractJavaAnnotations(node: any): string[] {
  const annotations: string[] = [];

  // Java: 遍历 class_declaration 的 modifiers 或直接子节点
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'marker_annotation') {
      // @Service（无参数）
      const nameNode = child.childForFieldName('name') ?? child.namedChild(0);
      if (nameNode) {
        annotations.push('@' + nameNode.text);
      }
    } else if (child.type === 'annotation') {
      // @RequestMapping("/api")（有参数）
      const nameNode = child.childForFieldName('name') ?? child.namedChild(0);
      if (nameNode) {
        annotations.push('@' + nameNode.text);
      }
    }
  }

  return annotations;
}

/**
 * 提取 TypeScript 装饰器（如 @Controller）
 */
function extractTSDecorators(node: any): string[] {
  const decorators: string[] = [];

  // TypeScript: decorator 节点在 class 前面
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'decorator') {
      const nameNode = child.namedChild(0);
      if (nameNode) {
        decorators.push('@' + nameNode.text);
      }
    }
  }

  return decorators;
}

/**
 * 提取类注释（Javadoc/JSDoc）
 */
function extractDocComment(node: any): string | null {
  // Tree-sitter: 前一个兄弟节点可能是 comment
  const prevSibling = node.previousSibling;
  if (prevSibling?.type === 'comment' || prevSibling?.type === 'block_comment') {
    const text = prevSibling.text;
    // 清理注释格式
    if (text.startsWith('/**') || text.startsWith('/*')) {
      return text
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '')
        .replace(/^\s*\*\s?/gm, '')  // 移除每行开头的 *
        .trim();
    }
    return text;
  }
  return null;
}

// ── Symbol Extraction ──────────────────────────────────────

function extractSymbolsFromAST(root: any, filePath: string, symbols: ExtractedSymbol[]): void {
  const cursor = root.walk();

  const visitNode = (): void => {
    const node = cursor.currentNode;
    const nodeType = node.type;

    if (nodeType === 'class_declaration' || nodeType === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        // 提取注解和注释
        const annotations = extractJavaAnnotations(node);
        const docComment = extractDocComment(node);

        symbols.push({
          name: nameNode.text,
          type: nodeType === 'class_declaration' ? 'class' : 'interface',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {
            annotations,
            docComment,
          },
        });
      }
    } else if (nodeType === 'method_declaration' || nodeType === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: 'method',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {},
        });
      }
    } else if (nodeType === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: 'function',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {},
        });
      }
    } else if (nodeType === 'class_definition') {
      // TypeScript/Python class
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const decorators = extractTSDecorators(node);
        const docComment = extractDocComment(node);

        symbols.push({
          name: nameNode.text,
          type: 'class',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {
            annotations: decorators,
            docComment,
          },
        });
      }
    }

    // Recurse into children
    if (cursor.gotoFirstChild()) {
      visitNode();
      while (cursor.gotoNextSibling()) {
        visitNode();
      }
      cursor.gotoParent();
    }
  };

  visitNode();
}

function extractImportsFromAST(root: any, filePath: string, imports: ParseResult['imports']): void {
  const cursor = root.walk();

  const visitNode = (): void => {
    const node = cursor.currentNode;

    if (node.type === 'import_declaration' || node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source') || node.childForFieldName('argument');
      if (sourceNode) {
        imports.push({
          source: filePath,
          target: sourceNode.text.replace(/['"]/g, ''),
          location: { file: filePath, startLine: node.startPosition.row + 1 },
        });
      } else {
        // Java import_declaration: children are unnamed, find scoped_identifier or identifier
        let importPath = '';
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'scoped_identifier' || child.type === 'identifier') {
            importPath = child.text;
            break;
          }
        }
        if (importPath) {
          imports.push({
            source: filePath,
            target: importPath,
            location: { file: filePath, startLine: node.startPosition.row + 1 },
          });
        }
      }
    }

    if (cursor.gotoFirstChild()) {
      visitNode();
      while (cursor.gotoNextSibling()) {
        visitNode();
      }
      cursor.gotoParent();
    }
  };

  visitNode();
}

// ── Data Flow Extraction for Java ───────────────────────────

function extractDataFlowJava(root: any, lang: any, filePath: string, edges: DataFlowEdge[]): void {
  for (const queryStr of JAVA_DATA_FLOW_QUERIES) {
    try {
      const query = new Query(lang, queryStr);
      const matches = query.matches(root);

      for (const match of matches) {
        const captures = match.captures;
        const captureMap: Record<string, any> = {};
        for (const cap of captures) {
          captureMap[cap.name] = cap.node;
        }

        const edge = parseJavaDataFlowMatch(captureMap, filePath);
        if (edge) {
          edges.push(edge);
        }
      }
    } catch {
      // Query syntax error, skip
    }
  }
}

function parseJavaDataFlowMatch(captures: Record<string, any>, filePath: string): DataFlowEdge | null {
  const assignment = captures['assignment'];
  const callArg = captures['call_arg'];
  const retVal = captures['retval'];
  const dbRead = captures['db_read'];
  const dbWrite = captures['db_write'];

  const makeLocation = (node: any): DataFlowLocation => ({
    file: filePath,
    line: node.startPosition.row + 1,
    entity: node.text,
  });

  if (assignment && captures['target'] && captures['source']) {
    return {
      source: makeLocation(captures['source']),
      target: makeLocation(captures['target']),
      type: DataFlowType.assignment,
      confidence: Confidence.EXTRACTED,
    };
  }

  if (callArg && captures['arg'] && captures['source']) {
    return {
      source: makeLocation(captures['arg']),
      target: {
        ...makeLocation(captures['source']),
        field: captures['method']?.text,
      },
      type: DataFlowType.call_arg,
      confidence: Confidence.EXTRACTED,
    };
  }

  if (retVal) {
    return {
      source: makeLocation(retVal),
      target: {
        file: filePath,
        line: retVal.startPosition.row + 1,
        entity: '__return__',
      },
      type: DataFlowType.return,
      confidence: Confidence.EXTRACTED,
    };
  }

  if (dbRead && captures['repo'] && captures['method']) {
    return {
      source: makeLocation(captures['repo']),
      target: {
        file: filePath,
        line: dbRead.startPosition.row + 1,
        entity: 'database',
      },
      type: DataFlowType.db_read,
      confidence: Confidence.EXTRACTED,
    };
  }

  if (dbWrite && captures['repo'] && captures['method']) {
    return {
      source: {
        file: filePath,
        line: dbWrite.startPosition.row + 1,
        entity: 'entity',
      },
      target: makeLocation(captures['repo']),
      type: DataFlowType.db_write,
      confidence: Confidence.EXTRACTED,
    };
  }

  return null;
}

// ── Data Flow Extraction for TypeScript ────────────────────

function extractDataFlowTS(root: any, lang: any, filePath: string, edges: DataFlowEdge[]): void {
  for (const queryStr of TS_DATA_FLOW_QUERIES) {
    try {
      const query = new Query(lang, queryStr);
      const matches = query.matches(root);

      for (const match of matches) {
        const captures = match.captures;
        const captureMap: Record<string, any> = {};
        for (const cap of captures) {
          captureMap[cap.name] = cap.node;
        }

        const edge = parseTSDataFlowMatch(captureMap, filePath);
        if (edge) {
          edges.push(edge);
        }
      }
    } catch {
      // Query syntax error, skip
    }
  }
}

function parseTSDataFlowMatch(captures: Record<string, any>, filePath: string): DataFlowEdge | null {
  const makeLocation = (node: any): DataFlowLocation => ({
    file: filePath,
    line: node.startPosition.row + 1,
    entity: node.text,
  });

  const assignment = captures['assignment'];
  const callArg = captures['call_arg'];
  const retVal = captures['retval'];

  if (assignment && captures['target'] && captures['source']) {
    return {
      source: makeLocation(captures['source']),
      target: makeLocation(captures['target']),
      type: DataFlowType.assignment,
      confidence: Confidence.EXTRACTED,
    };
  }

  if (callArg && captures['arg'] && captures['source']) {
    return {
      source: makeLocation(captures['arg']),
      target: {
        ...makeLocation(captures['source']),
        field: captures['method']?.text,
      },
      type: DataFlowType.call_arg,
      confidence: Confidence.EXTRACTED,
    };
  }

  if (retVal) {
    return {
      source: makeLocation(retVal),
      target: {
        file: filePath,
        line: retVal.startPosition.row + 1,
        entity: '__return__',
      },
      type: DataFlowType.return,
      confidence: Confidence.EXTRACTED,
    };
  }

  return null;
}

// ── Standalone Data Flow Extractor ──────────────────────────

interface DataFlowExtractResult {
  success: boolean;
  data?: {
    filePath: string;
    dataFlowEdges: DataFlowEdge[];
  };
  error?: string;
  warning?: string;
}

async function extractDataFlow(filePath: string, content: string, language: string): Promise<DataFlowExtractResult> {
  await initParser();

  if (content.length > MAX_FILE_SIZE) {
    return {
      success: true,
      data: { filePath, dataFlowEdges: [] },
      warning: `File too large (${Math.round(content.length / 1024)}KB), skipped`,
    };
  }

  const grammarName = SUPPORTED_LANGUAGES[language];
  if (!grammarName || !Parser) {
    return { success: true, data: { filePath, dataFlowEdges: [] } };
  }

  try {
    const lang = await loadLanguage(grammarName);
    if (!lang) {
      return { success: true, data: { filePath, dataFlowEdges: [] } };
    }

    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const dataFlowEdges: DataFlowEdge[] = [];

    if (grammarName === 'java') {
      extractDataFlowJava(root, lang, filePath, dataFlowEdges);
    } else if (grammarName === 'typescript' || grammarName === 'tsx') {
      extractDataFlowTS(root, lang, filePath, dataFlowEdges);
    }

    return { success: true, data: { filePath, dataFlowEdges } };
  } catch (error) {
    return {
      success: false,
      error: `Data flow extraction failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type {
  ASTNode,
  ParsedFile,
  ExtractedSymbol,
  ParseResult,
  DataFlowExtractResult,
};
export {
  createTreeSitterTool,
  SUPPORTED_LANGUAGES,
  extractDataFlow,
  initParser,
  loadLanguage,
};
