/**
 * 业务领域配置 API。
 */
import httpClient from "./graphApi";
import type { DomainConfig, DomainDefinition, InferredDomain } from "../store/lineageStore";

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
};

export default domainApi;
