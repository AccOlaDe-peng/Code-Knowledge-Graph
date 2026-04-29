// ReportAgent — analysis report generation

import { BaseAgent } from '../BaseAgent.ts';
import { createLLMTool, type LLMResponse } from '../tools/LLMTool.ts';
import { createGraphStoreTool, type GraphStoreResult } from '../tools/GraphStoreTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import { Confidence } from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';

const REPORT_CONFIG: AgentConfig = {
  name: 'ReportAgent',
  description: 'Generates comprehensive analysis reports from the knowledge graph',
  tools: ['LLMTool', 'GraphStoreTool'],
  model: 'sonnet',
};

interface ReportSection {
  title: string;
  content: string;
  confidence: Confidence;
}

interface AnalysisReport {
  summary: string;
  sections: ReportSection[];
  metrics: {
    totalNodes: number;
    totalEdges: number;
    nodeTypes: Record<string, number>;
    edgeTypes: Record<string, number>;
    godNodes: number;
    crossModuleLinks: number;
  };
  recommendations: string[];
}

class ReportAgent extends BaseAgent {
  private nodes: GraphNode[];
  private edges: GraphEdge[];

  constructor(id: string, context: AgentContext, nodes: GraphNode[], edges: GraphEdge[]) {
    super(id, REPORT_CONFIG, context, [createLLMTool(), createGraphStoreTool()]);
    this.nodes = nodes;
    this.edges = edges;
  }

  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let tokensUsed = 0;

    try {
      // Load complete graph for analysis
      const graphResult = await this.useTool('GraphStoreTool', {
        operation: 'load',
      }) as GraphStoreResult;

      const graphData = graphResult.data as { nodes: GraphNode[]; edges: GraphEdge[] } | null;
      const graphNodes = graphData?.nodes ?? this.nodes;
      const graphEdges = graphData?.edges ?? this.edges;

      // Compute metrics
      const metrics = this.computeMetrics(graphNodes, graphEdges);

      // Generate sections
      const sections = this.generateSections(graphNodes, graphEdges, metrics);

      // Check if LLM is available
      const hasLLM = !!(process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || process.env.LLM_BASE_URL);
      let recommendations: string[] = [];

      if (hasLLM) {
        // Use LLM to synthesize findings
        const prompt = this.buildPrompt(sections, metrics);
        const response = await this.useTool('LLMTool', {
          prompt,
          config: { model: 'sonnet', maxTokens: 2048 },
        }) as LLMResponse;

        tokensUsed = response.tokensUsed;
        recommendations = this.parseRecommendations(response.content);
      } else {
        // Static recommendations based on metrics
        recommendations = this.generateStaticRecommendations(metrics, graphNodes, graphEdges);
      }

      // Create report node
      const reportNode: GraphNode = {
        id: 'report:analysis',
        label: 'Code Analysis Report',
        type: 'Module' as any, // Using Module as report container
        file: '',
        confidence: Confidence.INFERRED,
        metadata: {
          summary: sections[0]?.content ?? '',
          metrics,
          recommendations,
          generatedAt: new Date().toISOString(),
        },
      };
      nodes.push(reportNode);

      const result = this.createResult(nodes, edges, {
        confidence: Confidence.INFERRED,
        source: 'report',
        filesProcessed: [],
        tokensUsed,
      });

      await this.onTaskComplete(result);
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private computeMetrics(nodes: GraphNode[], edges: GraphEdge[]): AnalysisReport['metrics'] {
    const nodeTypes: Record<string, number> = {};
    const edgeTypes: Record<string, number> = {};

    for (const node of nodes) {
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }

    for (const edge of edges) {
      edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
    }

    const godNodes = nodes.filter(n => n.id.startsWith('godnode:')).length;
    const crossModuleLinks = edges.filter(e => e.metadata?.surprising === true).length;

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodeTypes,
      edgeTypes,
      godNodes,
      crossModuleLinks,
    };
  }

  private generateSections(
    nodes: GraphNode[],
    edges: GraphEdge[],
    metrics: AnalysisReport['metrics'],
  ): ReportSection[] {
    const sections: ReportSection[] = [];

    // Summary
    sections.push({
      title: 'Summary',
      content: `Analyzed ${metrics.totalNodes} nodes and ${metrics.totalEdges} edges. ` +
        `Found ${metrics.godNodes} highly-coupled nodes (God Nodes) and ` +
        `${metrics.crossModuleLinks} cross-module connections.`,
      confidence: Confidence.EXTRACTED,
    });

    // Architecture overview
    const moduleNodes = nodes.filter(n => n.type === 'Module' || n.type === 'Class');
    const topImports = Object.entries(metrics.edgeTypes)
      .filter(([type]) => type === 'imports')
      .map(([, count]) => count);

    sections.push({
      title: 'Architecture',
      content: `Project contains ${moduleNodes.length} modules/classes. ` +
        `Import relationships: ${topImports[0] ?? 0}. ` +
        `Distribution: ${Object.entries(metrics.nodeTypes).map(([k, v]) => `${k}(${v})`).join(', ')}.`,
      confidence: Confidence.EXTRACTED,
    });

    // God Node warnings
    const godNodes = nodes.filter(n => n.id.startsWith('godnode:'));
    if (godNodes.length > 0) {
      sections.push({
        title: 'Coupling Warnings',
        content: `High coupling detected in: ${godNodes.map(n => n.label).join(', ')}. ` +
          `Consider refactoring these nodes to reduce dependencies.`,
        confidence: Confidence.AMBIGUOUS,
      });
    }

    // Cross-module connections
    const surprisingEdges = edges.filter(e => e.metadata?.surprising);
    if (surprisingEdges.length > 0) {
      sections.push({
        title: 'Cross-Module Connections',
        content: `${surprisingEdges.length} connections span across module boundaries. ` +
          `Review these for intentional vs accidental coupling.`,
        confidence: Confidence.AMBIGUOUS,
      });
    }

    return sections;
  }

  private buildPrompt(sections: ReportSection[], metrics: AnalysisReport['metrics']): string {
    const sectionText = sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');

    return `Based on the following analysis, provide actionable recommendations:

${sectionText}

Metrics:
- Total nodes: ${metrics.totalNodes}
- Total edges: ${metrics.totalEdges}
- God nodes (high coupling): ${metrics.godNodes}
- Cross-module links: ${metrics.crossModuleLinks}

Provide 3-5 specific, actionable recommendations for improving code quality and architecture.

Respond in JSON:
{
  "recommendations": [
    "recommendation 1",
    "recommendation 2"
  ]
}`;
  }

  private parseRecommendations(content: string): string[] {
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) return [];

      const data = JSON.parse(jsonMatch[1]!) as { recommendations?: string[] };
      return data.recommendations ?? [];
    } catch {
      return [];
    }
  }

  private generateStaticRecommendations(
    metrics: AnalysisReport['metrics'],
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): string[] {
    const recommendations: string[] = [];

    // God nodes warning
    if (metrics.godNodes > 0) {
      const godNodeList = nodes
        .filter(n => n.id.startsWith('godnode:'))
        .map(n => n.label)
        .slice(0, 3)
        .join(', ');
      recommendations.push(
        `Refactor highly-coupled nodes (${godNodeList}) to reduce dependencies and improve maintainability.`,
      );
    }

    // Cross-module coupling
    if (metrics.crossModuleLinks > 5) {
      recommendations.push(
        `Review ${metrics.crossModuleLinks} cross-module connections for intentional vs accidental coupling.`,
      );
    }

    // Import complexity
    const importCount = metrics.edgeTypes['imports'] ?? 0;
    if (importCount > 50) {
      recommendations.push(
        `High import count (${importCount}) suggests potential circular dependencies. Consider module restructuring.`,
      );
    }

    // Class/function ratio
    const classCount = metrics.nodeTypes['Class'] ?? 0;
    const funcCount = metrics.nodeTypes['Function'] ?? 0;
    if (classCount > 0 && funcCount / classCount > 20) {
      recommendations.push(
        `High function-to-class ratio (${funcCount}/${classCount}). Consider grouping related functions into classes.`,
      );
    }

    // Default recommendation
    if (recommendations.length === 0) {
      recommendations.push(
        'Analysis completed successfully. No significant architectural issues detected.',
      );
    }

    return recommendations;
  }

  onTaskStart(_task: Task): Promise<void> { return Promise.resolve(); }
  onTaskComplete(_result: AgentResult): Promise<void> { return Promise.resolve(); }
  onError(_error: Error): Promise<void> { return Promise.resolve(); }
}

export { ReportAgent, REPORT_CONFIG };
