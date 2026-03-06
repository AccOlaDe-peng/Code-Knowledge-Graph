import { Injectable, Logger } from '@nestjs/common';
import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import * as path from 'path';

export interface FileNode {
  filePath: string;
  imports: string[];
  exports: string[];
  functions: FunctionNode[];
  classes: ClassNode[];
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
      } catch (error) {
        this.logger.warn(
          `Failed to analyze file ${sourceFile.getFilePath()}: ${error.message}`,
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

    return {
      filePath,
      imports,
      exports,
      functions,
      classes,
    };
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

    sourceFile.getExportedDeclarations().forEach((declarations, name) => {
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
