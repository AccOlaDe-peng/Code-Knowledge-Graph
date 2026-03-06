import { Injectable, Logger } from '@nestjs/common';
import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import * as path from 'path';

export type DataRole = 'source' | 'sink' | 'mixed' | 'transform' | 'unknown';
export type ArchLayer = 'controller' | 'service' | 'repository' | 'model' | 'unknown';
export type CodeType = 'frontend' | 'backend' | 'unknown';

export interface HttpEndpoint {
  method: string;
  path: string;
  handler: string;
}

export interface FileNode {
  filePath: string;
  content?: string; // 文件内容（用于 AI 分析）
  imports: string[];
  exports: string[];
  functions: FunctionNode[];
  classes: ClassNode[];
  dataRole: DataRole;
  layer: ArchLayer;
  codeType: CodeType;
  httpEndpoints: HttpEndpoint[];
}

export interface FunctionNode {
  name: string;
  line: number;
  calls: string[];
}

export interface ClassNode {
  name: string;
  line: number;
  methods: string[];
  extends?: string;
}

const SOURCE_PATTERNS = [
  /\baxios\s*\./,
  /\bfetch\s*\(/,
  /\bhttp\s*\.\s*(get|post|put|delete|patch|request)\s*\(/i,
  /\bHttpClient\b/,
  /\.(find|findOne|findAll|findMany|findFirst)\s*\(/,
  /\.query\s*\(/,
  /\.createQueryBuilder\s*\(/,
  /\bprisma\s*\./,
  /\bSELECT\b/i,
];

const SINK_PATTERNS = [
  /\.(save|insert|create|update|delete|remove|upsert)\s*\(/,
  /\.execute\s*\(/,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\b(res|response)\s*\.\s*(send|json|status|end)\s*\(/,
];

const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Delete', 'Patch'];
const INFRA_SUFFIXES = ['.module.ts', '.guard.ts', '.middleware.ts', '.interceptor.ts', '.pipe.ts', '.filter.ts', '.decorator.ts'];

@Injectable()
export class CodeAnalyzerService {
  private readonly logger = new Logger(CodeAnalyzerService.name);

  async analyzeProject(projectPath: string): Promise<FileNode[]> {
    this.logger.log(`Starting analysis of project: ${projectPath}`);

    const project = new Project({
      tsConfigFilePath: this.findTsConfig(projectPath),
      skipAddingFilesFromTsConfig: true,
    });

    project.addSourceFilesAtPaths(`${projectPath}/**/*.{ts,tsx,js,jsx}`);

    const sourceFiles = project.getSourceFiles();
    const fileNodes: FileNode[] = [];

    for (const sourceFile of sourceFiles) {
      try {
        const fileNode = this.analyzeFile(sourceFile, projectPath);
        fileNodes.push(fileNode);
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to analyze file ${sourceFile.getFilePath()}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`Analysis complete. Processed ${fileNodes.length} files`);

    return fileNodes;
  }

  private analyzeFile(sourceFile: SourceFile, projectPath: string): FileNode {
    const filePath = path.relative(projectPath, sourceFile.getFilePath());

    const imports = this.extractImports(sourceFile);
    const exports = this.extractExports(sourceFile);
    const functions = this.extractFunctions(sourceFile);
    const classes = this.extractClasses(sourceFile);
    const dataRole = this.detectDataRole(sourceFile, filePath);
    const layer = this.detectArchLayer(sourceFile, filePath);
    const codeType = this.detectCodeType(sourceFile, filePath, imports);
    const httpEndpoints = this.extractHttpEndpoints(sourceFile);

    // 获取文件内容用于 AI 分析（限制大小以避免超出 token 限制）
    const content = sourceFile.getFullText();
    const maxContentLength = 10000; // 限制为 10000 字符
    const truncatedContent = content.length > maxContentLength
      ? content.substring(0, maxContentLength) + '\n\n... (内容已截断)'
      : content;

    return {
      filePath,
      content: truncatedContent,
      imports,
      exports,
      functions,
      classes,
      dataRole,
      layer,
      codeType,
      httpEndpoints,
    };
  }

  private detectDataRole(sourceFile: SourceFile, filePath: string): DataRole {
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    const fullText = calls.map(c => c.getText()).join('\n');

    const hasSource = SOURCE_PATTERNS.some(p => p.test(fullText));
    const hasSink = SINK_PATTERNS.some(p => p.test(fullText));

    if (hasSource && hasSink) return 'mixed';
    if (hasSource) return 'source';
    if (hasSink) return 'sink';

    const baseName = path.basename(filePath).toLowerCase();
    if (/service|util|helper|transform|mapper|converter/.test(baseName)) return 'transform';

    return 'unknown';
  }

  private detectArchLayer(sourceFile: SourceFile, filePath: string): ArchLayer {
    const baseName = path.basename(filePath).toLowerCase();

    // 基础设施文件直接排除
    if (INFRA_SUFFIXES.some(s => filePath.endsWith(s))) return 'unknown';

    // 优先从装饰器检测
    for (const cls of sourceFile.getClasses()) {
      for (const decorator of cls.getDecorators()) {
        const name = decorator.getName();
        if (name === 'Controller') return 'controller';
        if (name === 'Entity') return 'model';
      }
      // @Injectable 类中检查是否有 @InjectRepository → repository
      const hasInjectable = cls.getDecorators().some(d => d.getName() === 'Injectable');
      if (hasInjectable) {
        const hasInjectRepository = cls.getProperties().some(p =>
          p.getDecorators().some(d => d.getName() === 'InjectRepository')
        ) || cls.getConstructors().some(ctor =>
          ctor.getParameters().some(param =>
            param.getDecorators().some(d => d.getName() === 'InjectRepository')
          )
        );
        if (hasInjectRepository) return 'repository';
        return 'service';
      }
    }

    // 兜底：文件名约定
    if (baseName.endsWith('controller.ts') || baseName.endsWith('controller.js')) return 'controller';
    if (baseName.endsWith('service.ts') || baseName.endsWith('service.js')) return 'service';
    if (baseName.endsWith('repository.ts') || baseName.endsWith('dao.ts')) return 'repository';
    if (baseName.endsWith('.entity.ts') || baseName.endsWith('.model.ts') ||
        baseName.endsWith('.dto.ts') || baseName.endsWith('.schema.ts')) return 'model';

    return 'unknown';
  }

  private detectCodeType(sourceFile: SourceFile, filePath: string, _resolvedImports: string[]): CodeType {
    // 1. 文件扩展名 —— .vue 必然是前端
    if (filePath.endsWith('.vue') || filePath.endsWith('.svelte')) return 'frontend';

    // 2. 已确定为后端层（NestJS 装饰器 / 命名约定）的文件直接归为后端
    const layer = this.detectArchLayer(sourceFile, filePath);
    if (layer !== 'unknown') return 'backend';

    // 3. 通过 npm 包导入判断
    const allImports = sourceFile
      .getImportDeclarations()
      .map(d => d.getModuleSpecifierValue());

    const FRONTEND_PKGS = ['vue', 'react', 'react-dom', 'pinia', 'vuex', 'vite',
      'next', 'nuxt', 'svelte', '@vue/', '@angular/', '@react-'];
    const BACKEND_PKGS = ['@nestjs/', 'express', 'koa', 'fastify', 'hapi',
      'typeorm', 'mongoose', 'sequelize', '@prisma/', 'bull', 'ioredis'];

    const hasFrontend = allImports.some(m => FRONTEND_PKGS.some(p => m === p || m.startsWith(p)));
    const hasBackend  = allImports.some(m => BACKEND_PKGS.some(p => m === p || m.startsWith(p)));

    if (hasFrontend && !hasBackend) return 'frontend';
    if (hasBackend  && !hasFrontend) return 'backend';

    // 4. 路径约定（目录名）
    const normalized = filePath.replace(/\\/g, '/');
    const FRONTEND_DIRS = [/\/components?\//, /\/views?\//, /\/pages?\//, /\/composables?\//, /\/hooks?\//, /\/store\//, /\/router\//];
    const BACKEND_DIRS  = [/\/controllers?\//, /\/services?\//, /\/entities?\//, /\/repositories?\//, /\/middlewares?\//, /\/guards?\//];

    if (FRONTEND_DIRS.some(p => p.test(normalized))) return 'frontend';
    if (BACKEND_DIRS.some(p => p.test(normalized)))  return 'backend';

    // 5. 文件名后缀约定
    const baseName = path.basename(filePath).toLowerCase();
    if (baseName.endsWith('.component.ts') || baseName.endsWith('.component.tsx')) return 'frontend';
    if (baseName.endsWith('.store.ts') || baseName.endsWith('.composable.ts')) return 'frontend';

    return 'unknown';
  }

  private extractHttpEndpoints(sourceFile: SourceFile): HttpEndpoint[] {
    const endpoints: HttpEndpoint[] = [];

    sourceFile.getClasses().forEach(cls => {
      cls.getMethods().forEach(method => {
        method.getDecorators().forEach(decorator => {
          const decoratorName = decorator.getName();
          if (HTTP_DECORATORS.includes(decoratorName)) {
            const args = decorator.getArguments();
            const httpPath = args.length > 0
              ? args[0].getText().replace(/['"]/g, '')
              : '/';
            endpoints.push({
              method: decoratorName.toUpperCase(),
              path: httpPath,
              handler: method.getName(),
            });
          }
        });
      });
    });

    return endpoints;
  }

  private extractImports(sourceFile: SourceFile): string[] {
    const imports: string[] = [];

    sourceFile.getImportDeclarations().forEach((importDecl) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
        imports.push(moduleSpecifier);
      }
    });

    return imports;
  }

  private extractExports(sourceFile: SourceFile): string[] {
    const exports: string[] = [];

    sourceFile.getExportedDeclarations().forEach((_declarations, name) => {
      exports.push(name);
    });

    return exports;
  }

  private extractFunctions(sourceFile: SourceFile): FunctionNode[] {
    const functions: FunctionNode[] = [];

    sourceFile.getFunctions().forEach((func) => {
      const name = func.getName() || 'anonymous';
      const line = func.getStartLineNumber();
      const calls = this.extractFunctionCalls(func.getBody()?.getText() || '');

      functions.push({ name, line, calls });
    });

    return functions;
  }

  private extractClasses(sourceFile: SourceFile): ClassNode[] {
    const classes: ClassNode[] = [];

    sourceFile.getClasses().forEach((cls) => {
      const name = cls.getName() || 'anonymous';
      const line = cls.getStartLineNumber();
      const methods = cls.getMethods().map((m) => m.getName());
      const extendsClause = cls.getExtends()?.getText();

      classes.push({
        name,
        line,
        methods,
        extends: extendsClause,
      });
    });

    return classes;
  }

  private extractFunctionCalls(code: string): string[] {
    const calls: string[] = [];
    const callPattern = /(\w+)\s*\(/g;
    let match;

    while ((match = callPattern.exec(code)) !== null) {
      calls.push(match[1]);
    }

    return [...new Set(calls)];
  }

  private findTsConfig(projectPath: string): string | undefined {
    const tsConfigPath = path.join(projectPath, 'tsconfig.json');
    const fs = require('fs');

    if (fs.existsSync(tsConfigPath)) {
      return tsConfigPath;
    }

    return undefined;
  }
}
