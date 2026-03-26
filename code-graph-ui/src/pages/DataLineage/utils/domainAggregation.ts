/**
 * 业务领域聚合工具函数。
 *
 * 用于将 Class 级血缘数据聚合为业务领域级视图。
 */
import type { DomainDefinition, InferredDomain } from "../../../store/lineageStore";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface RawNode {
  id: string;
  type: string;
  name?: string;
  properties?: Record<string, unknown>;
}

export interface RawEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface BusinessDomainNode {
  id: string;
  key: string;
  name: string;
  aliases: string[];
  color: string;
  nodeCount: number;
  services: NodeSummary[];
  controllers: NodeSummary[];
  repositories: NodeSummary[];
  inModules: string[];
  databases: string[];
  nodeIds: string[];
}

export interface NodeSummary {
  id: string;
  name: string;
  module: string;
}

export interface DomainEdge {
  from: string;
  to: string;
  type: "flow_to" | "reads" | "writes";
  callCount: number;
  servicePairs: [string, string][];
}

export interface DomainData {
  domains: BusinessDomainNode[];
  edges: DomainEdge[];
}

// ─── 中文名称推断规则 ─────────────────────────────────────────────────────────

const DOMAIN_NAME_INFERENCE: Record<string, string> = {
  // 缩写展开
  drs: "数据报表服务",
  mdm: "主数据管理",
  frs: "风险扫描",
  bav: "资产漏洞检测",
  srs: "安全报告服务",
  agm: "资产管理集成",
  nbu: "备份服务",
  // 常见词翻译
  permission: "权限管理",
  engine: "引擎服务",
  dashboard: "仪表盘",
  dashbord: "仪表盘",
  email: "邮件服务",
  report: "报表服务",
  white: "白名单管理",
  application: "应用管理",
  preAnalysis: "预分析服务",
  preanalysis: "预分析服务",
  config: "配置管理",
  log: "日志服务",
  auth: "认证服务",
  policy: "策略管理",
  sharding: "分片配置",
  direct: "直连服务",
  flow: "流程服务",
  utils: "工具服务",
  handler: "处理器",
  factory: "工厂服务",
  process: "流程处理",
  data: "数据服务",
  http: "HTTP服务",
};

// 领域颜色预设
const DOMAIN_COLORS = [
  "#00d4ff", // 青色
  "#00f084", // 绿色
  "#ffc145", // 琥珀色
  "#b08eff", // 紫色
  "#ff6b6b", // 红色
  "#7ed957", // 浅绿
  "#ffcc44", // 黄色
  "#44aaff", // 浅蓝
  "#ff9f43", // 橙色
  "#a55eea", // 深紫
];

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 从节点 ID 中提取业务关键字。
 */
export function extractBusinessKey(nodeId: string): string | null {
  if (!nodeId) return null;

  // 移除前缀
  const body = nodeId.includes(":") ? nodeId.split(":").slice(1).join(":") : nodeId;
  const parts = body.split("/");

  // 跳过特殊节点
  const specialPrefixes = ["datasource", "database", "topic", "external", "module"];
  if (parts.length > 0 && specialPrefixes.includes(parts[0])) {
    return null;
  }

  // 寻找业务目录
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (
      part === "service" ||
      part === "services" ||
      part === "controller" ||
      part === "controllers" ||
      part === "repository" ||
      part === "repositories" ||
      part === "mapper" ||
      part === "dao"
    ) {
      // 下一个目录就是业务目录
      if (i + 1 < parts.length) {
        const bizDir = parts[i + 1];
        // 过滤掉一些非业务目录
        const nonBizDirs = [
          "impl",
          "dto",
          "entity",
          "vo",
          "util",
          "utils",
          "common",
          "config",
          "base",
          "test",
        ];
        if (!nonBizDirs.includes(bizDir.toLowerCase())) {
          return bizDir;
        }
      }
    }
  }

  return null;
}

/**
 * 从类名中提取业务前缀。
 */
export function extractClassPrefix(nodeName: string): string | null {
  if (!nodeName) return null;

  // 移除常见后缀
  const suffixes = [
    "ServiceImpl",
    "Service",
    "Controller",
    "Repository",
    "Dao",
    "Mapper",
    "DaoImpl",
    "Component",
    "Handler",
    "Factory",
  ];

  for (const suffix of suffixes) {
    if (nodeName.endsWith(suffix)) {
      const prefix = nodeName.slice(0, -suffix.length);
      if (prefix && prefix.length <= 15) {
        return prefix.toLowerCase();
      }
    }
  }

  return null;
}

/**
 * 从节点 ID 中提取技术模块名。
 */
export function extractModuleName(nodeId: string): string | null {
  if (!nodeId) return null;

  const body = nodeId.includes(":") ? nodeId.split(":")[1] : nodeId;
  const parts = body.split("/");

  if (parts.length >= 1 && parts[0]) {
    return parts[0];
  }

  return null;
}

/**
 * 推断业务领域名称。
 */
export function inferDomainName(key: string): string {
  // 先尝试精确匹配
  if (key in DOMAIN_NAME_INFERENCE) {
    return DOMAIN_NAME_INFERENCE[key];
  }

  // 尝试小写匹配
  const lowerKey = key.toLowerCase();
  if (lowerKey in DOMAIN_NAME_INFERENCE) {
    return DOMAIN_NAME_INFERENCE[lowerKey];
  }

  // 默认处理：驼峰转空格
  const name = key.replace(/([A-Z])/g, " $1").trim();
  return name || key;
}

/**
 * 将节点匹配到业务领域。
 */
export function matchNodeToDomain(
  nodeId: string,
  nodeName: string,
  domains: DomainDefinition[]
): string | null {
  // 从路径提取业务关键字
  let bizKey = extractBusinessKey(nodeId);
  if (!bizKey) {
    bizKey = extractClassPrefix(nodeName);
  }

  if (!bizKey) return null;

  // 匹配领域
  const bizKeyLower = bizKey.toLowerCase();
  for (const domain of domains) {
    const domainKey = domain.key.toLowerCase();
    const aliases = domain.aliases.map((a) => a.toLowerCase());

    if (bizKeyLower === domainKey || aliases.includes(bizKeyLower)) {
      return domain.id;
    }

    // 模糊匹配
    if (domainKey.includes(bizKeyLower) || bizKeyLower.includes(domainKey)) {
      return domain.id;
    }
  }

  return null;
}

// ─── 聚合函数 ────────────────────────────────────────────────────────────────

// 业务节点类型白名单（性能优化）
// 注意：后端返回的节点类型可能是小写或首字母大写，需要兼容两种格式
const BUSINESS_NODE_TYPES = new Set([
  "Service", "service",
  "Component", "component",
  "Class", "class",
  "Function", "function",
  "Repository", "repository",
  "DAO", "dao",
  "APIEndpoint", "apiendpoint",
]);

/**
 * 将原始节点/边聚合为业务领域视图。
 *
 * 性能优化：
 * - 使用 Set 进行类型过滤
 * - 预构建领域查找 Map
 * - 避免重复字符串操作
 */
export function aggregateToBusinessDomain(
  nodes: RawNode[],
  edges: RawEdge[],
  domains: DomainDefinition[],
  inferredDomains: InferredDomain[]
): DomainData {
  // 预构建领域查找 Map（性能优化）
  const domainLookupMap = new Map<string, string>();
  for (const d of domains) {
    domainLookupMap.set(d.key.toLowerCase(), d.id);
    for (const alias of d.aliases) {
      domainLookupMap.set(alias.toLowerCase(), d.id);
    }
  }
  for (const d of inferredDomains) {
    const id = `domain:${d.key}`;
    domainLookupMap.set(d.key.toLowerCase(), id);
    for (const k of d.relatedKeys) {
      domainLookupMap.set(k.toLowerCase(), id);
    }
  }

  // 合并已定义领域和推断领域
  const allDomains: Array<DomainDefinition & { isDefined: boolean }> = [
    ...domains.map((d) => ({ ...d, isDefined: true })),
    ...inferredDomains.map((d) => ({
      id: `domain:${d.key}`,
      key: d.key,
      name: d.suggestedName,
      aliases: d.relatedKeys,
      color: d.suggestedColor,
      isDefined: false,
    })),
  ];

  // 预构建 id -> domainDef 映射
  const domainDefMap = new Map(allDomains.map((d) => [d.id, d]));

  // 节点 → 领域映射
  const nodeToDomain: Map<string, string> = new Map();
  const domainNodes: Map<string, BusinessDomainNode> = new Map();

  // 1. 分类节点到领域
  for (const node of nodes) {
    const nodeId = node.id;
    const nodeName = node.name || "";
    const nodeType = node.type;

    // 过滤非业务节点（使用 Set 优化）
    if (!BUSINESS_NODE_TYPES.has(nodeType)) {
      continue;
    }

    // 过滤测试类
    if (nodeId.includes("/test/") || nodeName.includes("Test")) {
      continue;
    }

    // 提取业务关键字
    const bizKey = extractBusinessKey(nodeId) || extractClassPrefix(nodeName);
    if (!bizKey) continue;

    // 使用预构建 Map 快速查找领域
    let domainId = domainLookupMap.get(bizKey.toLowerCase());

    // 如果 Map 查找失败，尝试完整匹配逻辑
    if (!domainId) {
      domainId = matchNodeToDomain(nodeId, nodeName, allDomains) ?? undefined;
    }

    if (!domainId) continue;

    nodeToDomain.set(nodeId, domainId);

    // 初始化领域节点
    if (!domainNodes.has(domainId)) {
      const domainDef = domainDefMap.get(domainId);
      domainNodes.set(domainId, {
        id: domainId,
        key: domainDef?.key || "",
        name: domainDef?.name || domainId,
        aliases: domainDef?.aliases || [],
        color: domainDef?.color || DOMAIN_COLORS[domainNodes.size % DOMAIN_COLORS.length],
        nodeCount: 0,
        services: [],
        controllers: [],
        repositories: [],
        inModules: [],
        databases: [],
        nodeIds: [],
      });
    }

    const domainNode = domainNodes.get(domainId)!;
    domainNode.nodeCount++;
    domainNode.nodeIds.push(nodeId);

    // 提取模块名
    const moduleName = extractModuleName(nodeId);
    if (moduleName && !domainNode.inModules.includes(moduleName)) {
      domainNode.inModules.push(moduleName);
    }

    // 分类节点
    const nodeSummary: NodeSummary = {
      id: nodeId,
      name: nodeName,
      module: moduleName || "",
    };

    // 判断节点类型
    if (nodeType === "Service") {
      domainNode.services.push(nodeSummary);
    } else if (nodeType === "Component") {
      // 检查是否是 Controller
      const annotations = (node.properties?.annotations as string[]) || [];
      if (annotations.includes("@RestController") || annotations.includes("@Controller")) {
        domainNode.controllers.push(nodeSummary);
      }
    } else if (nodeType === "APIEndpoint") {
      domainNode.controllers.push(nodeSummary);
    } else if (nodeType === "Repository" || nodeType === "DAO") {
      domainNode.repositories.push(nodeSummary);
    } else if (nodeType === "Class") {
      // 检查是否是 Repository（通过类名）
      const name = nodeName.toLowerCase();
      if (
        name.includes("repository") ||
        name.includes("mapper") ||
        name.includes("dao")
      ) {
        domainNode.repositories.push(nodeSummary);
      }
    }
  }

  // 2. 聚合跨领域边
  const domainEdgeMap: Map<string, DomainEdge> = new Map();

  for (const edge of edges) {
    if (edge.type !== "calls") continue;

    const fromDomain = nodeToDomain.get(edge.from);
    const toDomain = nodeToDomain.get(edge.to);

    // 只处理跨领域调用
    if (!fromDomain || !toDomain || fromDomain === toDomain) continue;

    const key = `${fromDomain}->${toDomain}`;

    if (!domainEdgeMap.has(key)) {
      domainEdgeMap.set(key, {
        from: fromDomain,
        to: toDomain,
        type: "flow_to",
        callCount: 0,
        servicePairs: [],
      });
    }

    const domainEdge = domainEdgeMap.get(key)!;
    domainEdge.callCount++;

    // 提取服务对
    const fromName = edge.from.split("/").pop()?.split(":")[0] || "";
    const toName = edge.to.split("/").pop()?.split(":")[0] || "";
    const pair: [string, string] = [fromName, toName];

    if (!domainEdge.servicePairs.some((p) => p[0] === pair[0] && p[1] === pair[1])) {
      domainEdge.servicePairs.push(pair);
    }
  }

  // 3. 聚合 reads/writes 边（数据库访问）
  for (const edge of edges) {
    if (edge.type !== "reads" && edge.type !== "writes") continue;

    const fromDomain = nodeToDomain.get(edge.from);
    if (!fromDomain) continue;

    const domainNode = domainNodes.get(fromDomain);
    if (domainNode) {
      const dbName = edge.to.split(":").pop() || edge.to;
      if (!domainNode.databases.includes(dbName)) {
        domainNode.databases.push(dbName);
      }
    }
  }

  // 按节点数排序
  const sortedDomains = Array.from(domainNodes.values()).sort(
    (a, b) => b.nodeCount - a.nodeCount
  );

  return {
    domains: sortedDomains,
    edges: Array.from(domainEdgeMap.values()),
  };
}
