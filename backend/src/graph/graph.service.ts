import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { FileNode } from '../worker/code-analyzer.service';

@Injectable()
export class GraphService implements OnModuleDestroy {
  private readonly logger = new Logger(GraphService.name);
  private driver: Driver | null = null;

  constructor(private configService: ConfigService) {
    this.initializeDriver();
  }

  private initializeDriver() {
    const uri = this.configService.get<string>('NEO4J_URI') || 'bolt://localhost:7687';
    const user = this.configService.get<string>('NEO4J_USER') || 'neo4j';
    const password = this.configService.get<string>('NEO4J_PASSWORD') || 'neo4j';

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        encrypted: false,
        trust: 'TRUST_ALL_CERTIFICATES',
      });

      this.driver.verifyConnectivity()
        .then(() => {
          this.logger.log('Neo4j connection verified successfully');
        })
        .catch((err: Error) => {
          this.logger.error(`Neo4j connection verification failed: ${err.message}`);
        });

      this.logger.log(`Neo4j driver initialized for ${uri}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to initialize Neo4j driver: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.driver) {
      await this.driver.close();
      this.logger.log('Neo4j driver closed');
    }
  }

  getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized');
    }
    return this.driver.session();
  }

  async writeProjectGraph(projectId: string, fileNodes: FileNode[]) {
    const session = this.getSession();

    try {
      this.logger.log(`Writing graph data for project ${projectId}`);

      await session.run(
        'MERGE (p:Project {id: $projectId})',
        { projectId },
      );

      for (const fileNode of fileNodes) {
        await this.writeFileNode(session, projectId, fileNode);
      }

      this.logger.log(`Graph data written successfully for project ${projectId}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to write graph data: ${(error as Error).message}`);
      throw error;
    } finally {
      await session.close();
    }
  }

  private async writeFileNode(
    session: Session,
    projectId: string,
    fileNode: FileNode,
  ) {
    await session.run(
      `
      MATCH (p:Project {id: $projectId})
      MERGE (f:File {projectId: $projectId, path: $filePath})
      SET f.exports = $exports,
          f.dataRole = $dataRole,
          f.layer = $layer,
          f.codeType = $codeType
      MERGE (p)-[:CONTAINS]->(f)
      `,
      {
        projectId,
        filePath: fileNode.filePath,
        exports: fileNode.exports,
        dataRole: fileNode.dataRole || 'unknown',
        layer: fileNode.layer || 'unknown',
        codeType: fileNode.codeType || 'unknown',
      },
    );

    for (const importPath of fileNode.imports) {
      await session.run(
        `
        MATCH (f1:File {projectId: $projectId, path: $filePath})
        MERGE (f2:File {projectId: $projectId, path: $importPath})
        MERGE (f1)-[:IMPORTS]->(f2)
        `,
        {
          projectId,
          filePath: fileNode.filePath,
          importPath,
        },
      );
    }

    for (const func of fileNode.functions) {
      const endpoint = (fileNode.httpEndpoints || []).find(e => e.handler === func.name);
      await session.run(
        `
        MATCH (f:File {projectId: $projectId, path: $filePath})
        MERGE (fn:Function {projectId: $projectId, filePath: $filePath, name: $name})
        SET fn.line = $line, fn.calls = $calls,
            fn.httpMethod = $httpMethod, fn.httpPath = $httpPath
        MERGE (f)-[:CONTAINS]->(fn)
        `,
        {
          projectId,
          filePath: fileNode.filePath,
          name: func.name,
          line: func.line,
          calls: func.calls,
          httpMethod: endpoint?.method || null,
          httpPath: endpoint?.path || null,
        },
      );
    }

    for (const cls of fileNode.classes) {
      await session.run(
        `
        MATCH (f:File {projectId: $projectId, path: $filePath})
        MERGE (c:Class {projectId: $projectId, filePath: $filePath, name: $name})
        SET c.line = $line, c.methods = $methods, c.extends = $extends
        MERGE (f)-[:CONTAINS]->(c)
        `,
        {
          projectId,
          filePath: fileNode.filePath,
          name: cls.name,
          line: cls.line,
          methods: cls.methods,
          extends: cls.extends || null,
        },
      );
    }
  }

  async getFileDependencies(projectId: string, filePath: string) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH (f:File {projectId: $projectId, path: $filePath})-[:IMPORTS]->(imported:File)
        RETURN imported.path as path
        `,
        { projectId, filePath },
      );

      return result.records.map((record) => record.get('path'));
    } finally {
      await session.close();
    }
  }

  async getFileReferences(projectId: string, filePath: string) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH (f:File)-[:IMPORTS]->(target:File {projectId: $projectId, path: $filePath})
        RETURN f.path as path
        `,
        { projectId, filePath },
      );

      return result.records.map((record) => record.get('path'));
    } finally {
      await session.close();
    }
  }

  async findCircularDependencies(projectId: string) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH path = (f1:File {projectId: $projectId})-[:IMPORTS*]->(f1)
        WHERE length(path) > 1
        RETURN [node in nodes(path) | node.path] as cycle
        LIMIT 100
        `,
        { projectId },
      );

      return result.records.map((record) => record.get('cycle'));
    } finally {
      await session.close();
    }
  }

  async getProjectGraph(projectId: string) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH (p:Project {id: $projectId})-[:CONTAINS]->(f:File)
        OPTIONAL MATCH (f)-[r:IMPORTS]->(imported:File)
        RETURN f.path as file, collect(imported.path) as imports
        `,
        { projectId },
      );

      return result.records.map((record) => ({
        file: record.get('file'),
        imports: record.get('imports'),
      }));
    } finally {
      await session.close();
    }
  }

  async getFunctionCallChain(
    projectId: string,
    functionName: string,
    depth: number = 3,
  ) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH (fn:Function {projectId: $projectId, name: $functionName})
        RETURN fn.filePath as filePath, fn.line as line, fn.calls as calls
        LIMIT 1
        `,
        { projectId, functionName },
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        filePath: record.get('filePath'),
        line: record.get('line'),
        calls: record.get('calls'),
      };
    } finally {
      await session.close();
    }
  }

  async getDataLineageGraph(projectId: string) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH (p:Project {id: $projectId})-[:CONTAINS]->(f:File)
        OPTIONAL MATCH (f)-[:IMPORTS]->(imported:File {projectId: $projectId})
        RETURN f.path AS id,
               COALESCE(f.dataRole, 'unknown') AS dataRole,
               collect(imported.path) AS importedPaths
        `,
        { projectId },
      );

      const nodes: Array<{ id: string; label: string; dataRole: string }> = [];
      const edges: Array<{ id: string; source: string; target: string }> = [];
      const seenEdges = new Set<string>();

      for (const record of result.records) {
        const id = record.get('id') as string;
        if (!id) continue;
        nodes.push({
          id,
          label: id.split('/').pop() || id,
          dataRole: record.get('dataRole') as string,
        });

        const importedPaths = record.get('importedPaths') as string[];
        for (const target of importedPaths) {
          if (target) {
            const edgeKey = `${id}->${target}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              edges.push({ id: edgeKey.slice(0, 64), source: id, target });
            }
          }
        }
      }

      return { nodes, edges };
    } finally {
      await session.close();
    }
  }

  async getBusinessFlowGraph(projectId: string) {
    const session = this.getSession();

    try {
      const result = await session.run(
        `
        MATCH (p:Project {id: $projectId})-[:CONTAINS]->(f:File)
        WHERE f.layer IS NOT NULL AND f.layer <> 'unknown'
          AND (f.codeType IS NULL OR f.codeType <> 'frontend')
        OPTIONAL MATCH (f)-[:IMPORTS]->(imported:File {projectId: $projectId})
          WHERE imported.layer IS NOT NULL AND imported.layer <> 'unknown'
            AND (imported.codeType IS NULL OR imported.codeType <> 'frontend')
        OPTIONAL MATCH (f)-[:CONTAINS]->(fn:Function)
          WHERE fn.httpMethod IS NOT NULL
        RETURN f.path AS id,
               f.layer AS layer,
               collect(DISTINCT imported.path) AS importedPaths,
               collect(DISTINCT {method: fn.httpMethod, path: fn.httpPath, handler: fn.name}) AS endpoints
        `,
        { projectId },
      );

      const nodes: Array<{
        id: string;
        label: string;
        layer: string;
        endpoints: Array<{ method: string; path: string; handler: string }>;
      }> = [];
      const edges: Array<{ id: string; source: string; target: string }> = [];
      const seenEdges = new Set<string>();

      for (const record of result.records) {
        const id = record.get('id') as string;
        if (!id) continue;

        const rawEndpoints = record.get('endpoints') as Array<Record<string, string>> || [];
        const endpoints = rawEndpoints
          .filter(e => e && e.method)
          .map(e => ({ method: e.method, path: e.path || '/', handler: e.handler || '' }));

        nodes.push({
          id,
          label: id.split('/').pop() || id,
          layer: record.get('layer') as string,
          endpoints,
        });

        const importedPaths = record.get('importedPaths') as string[];
        for (const target of importedPaths) {
          if (target) {
            const edgeKey = `${id}->${target}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              edges.push({ id: edgeKey.slice(0, 64), source: id, target });
            }
          }
        }
      }

      return { nodes, edges };
    } finally {
      await session.close();
    }
  }

  async deleteProjectGraph(projectId: string) {
    const session = this.getSession();

    try {
      await session.run(
        `
        MATCH (n {projectId: $projectId})
        DETACH DELETE n
        `,
        { projectId },
      );

      this.logger.log(`Deleted graph data for project ${projectId}`);
    } finally {
      await session.close();
    }
  }
}
