/**
 * 业务领域配置 API。
 */
import httpClient from "./graphApi";
import type {
  DomainConfig,
  DomainDefinition,
  InferredDomain,
  DomainDescription,
  NodeDetail,
  CodeSnippet,
} from "../store/lineageStore";

// ─── API 响应类型 ────────────────────────────────────────────────────────────

interface DomainConfigResponse {
  repo_id: string;
  version: number;
  last_modified: string;
  domains: Array<{
    id: string;
    key: string;
    name: string;
    aliases: string[];
    color: string;
    icon?: string;
    description?: string;
  }>;
}

interface DomainConfigUpdateRequest {
  domains: Array<{
    id: string;
    key: string;
    name: string;
    aliases: string[];
    color: string;
    icon?: string;
    description?: string;
  }>;
}

interface InferResponse {
  repo_id: string;
  inferred: Array<{
    key: string;
    suggested_name: string;
    confidence: number;
    node_count: number;
    related_keys: string[];
    sample_nodes: string[];
    suggested_color: string;
  }>;
}

interface DomainDescriptionResponse {
  domain_id: string;
  summary: string;
  core_services: string[];
  data_flow_pattern: string;
  generated_at: string;
  confidence: number;
}

interface CodeSnippetResponse {
  node_id: string;
  language: string;
  content: string;
  start_line: number;
  end_line: number;
  highlight_lines: number[];
}

interface NodeDetailResponse {
  node_id: string;
  name: string;
  type: string;
  file: string;
  signature?: string;
  line?: number;
  end_line?: number;
  ai_description?: string;
  code_snippet?: CodeSnippetResponse;
  call_count: number;
  called_by_count: number;
  dependencies: string[];
  generated_at?: string;
}

interface BatchNodeInfoRequest {
  repo_id: string;
  domain_id: string;
  node_ids: string[];
}

interface BatchNodeInfoResponse {
  domain_id: string;
  domain_description?: DomainDescriptionResponse;
  nodes: NodeDetailResponse[];
  cached: boolean;
}

// ─── API 函数 ────────────────────────────────────────────────────────────────

export const domainApi = {
  /**
   * 获取仓库的业务领域配置。
   */
  async getDomainConfig(repoId: string): Promise<DomainConfig> {
    // httpClient 拦截器已经返回 res.data
    const response = await httpClient.get<unknown, DomainConfigResponse>(
      "/graph/lineage/domains/config",
      { params: { repo_id: repoId } }
    );

    return {
      repoId: response.repo_id,
      version: response.version,
      lastModified: response.last_modified,
      domains: response.domains.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        aliases: d.aliases,
        color: d.color,
        icon: d.icon,
        description: d.description,
      })),
    };
  },

  /**
   * 保存仓库的业务领域配置。
   */
  async saveDomainConfig(
    repoId: string,
    domains: DomainDefinition[]
  ): Promise<DomainConfig> {
    const request: DomainConfigUpdateRequest = {
      domains: domains.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        aliases: d.aliases,
        color: d.color,
        icon: d.icon,
        description: d.description,
      })),
    };

    const response = await httpClient.post<unknown, DomainConfigResponse>(
      "/graph/lineage/domains/config",
      request,
      { params: { repo_id: repoId } }
    );

    return {
      repoId: response.repo_id,
      version: response.version,
      lastModified: response.last_modified,
      domains: response.domains.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        aliases: d.aliases,
        color: d.color,
        icon: d.icon,
        description: d.description,
      })),
    };
  },

  /**
   * 自动推断业务领域。
   */
  async inferDomains(repoId: string): Promise<InferredDomain[]> {
    const response = await httpClient.get<unknown, InferResponse>(
      "/graph/lineage/domains/infer",
      { params: { repo_id: repoId } }
    );

    return response.inferred.map((d) => ({
      key: d.key,
      suggestedName: d.suggested_name,
      confidence: d.confidence,
      nodeCount: d.node_count,
      relatedKeys: d.related_keys,
      sampleNodes: d.sample_nodes,
      suggestedColor: d.suggested_color,
    }));
  },

  /**
   * 获取领域描述。
   */
  async getDomainDescription(
    repoId: string,
    domainId: string
  ): Promise<DomainDescription> {
    const response = await httpClient.get<unknown, DomainDescriptionResponse>(
      `/graph/lineage/domains/${domainId}/description`,
      { params: { repo_id: repoId } }
    );

    return {
      domainId: response.domain_id,
      summary: response.summary,
      coreServices: response.core_services,
      dataFlowPattern: response.data_flow_pattern,
      generatedAt: response.generated_at,
      confidence: response.confidence,
    };
  },

  /**
   * 批量获取节点信息。
   */
  async getBatchNodeInfo(
    repoId: string,
    domainId: string,
    nodeIds: string[]
  ): Promise<{
    domainDescription?: DomainDescription;
    nodes: NodeDetail[];
    cached: boolean;
  }> {
    const request: BatchNodeInfoRequest = {
      repo_id: repoId,
      domain_id: domainId,
      node_ids: nodeIds,
    };

    const response = await httpClient.post<unknown, BatchNodeInfoResponse>(
      "/graph/lineage/nodes/batch-info",
      request
    );

    return {
      domainDescription: response.domain_description
        ? {
            domainId: response.domain_description.domain_id,
            summary: response.domain_description.summary,
            coreServices: response.domain_description.core_services,
            dataFlowPattern: response.domain_description.data_flow_pattern,
            generatedAt: response.domain_description.generated_at,
            confidence: response.domain_description.confidence,
          }
        : undefined,
      nodes: response.nodes.map((n) => ({
        nodeId: n.node_id,
        name: n.name,
        type: n.type,
        file: n.file,
        signature: n.signature,
        line: n.line,
        endLine: n.end_line,
        aiDescription: n.ai_description,
        codeSnippet: n.code_snippet
          ? {
              language: n.code_snippet.language,
              content: n.code_snippet.content,
              startLine: n.code_snippet.start_line,
              highlightLines: n.code_snippet.highlight_lines,
            }
          : undefined,
        callCount: n.call_count,
        calledByCount: n.called_by_count,
        dependencies: n.dependencies,
        generatedAt: n.generated_at,
      })),
      cached: response.cached,
    };
  },

  /**
   * 获取节点代码片段。
   */
  async getNodeCodeSnippet(
    repoId: string,
    nodeId: string,
    highlight = true
  ): Promise<CodeSnippet> {
    const response = await httpClient.get<unknown, CodeSnippetResponse>(
      `/graph/lineage/nodes/${nodeId}/code`,
      { params: { repo_id: repoId, highlight } }
    );

    return {
      language: response.language,
      content: response.content,
      startLine: response.start_line,
      highlightLines: response.highlight_lines,
    };
  },
};

export default domainApi;
