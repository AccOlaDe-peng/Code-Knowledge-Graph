/**
 * 模块聚合工具函数。
 *
 * 用于将 Class 级血缘数据聚合为 Module 级视图。
 */

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

export interface ModuleNode {
  id: string;
  name: string;
  serviceCount: number;
  controllerCount: number;
  repositoryCount: number;
  services: Array<{ id: string; name: string }>;
  controllers: Array<{ id: string; name: string }>;
  repositories: Array<{ id: string; name: string }>;
  databases: Array<{ id: string; name: string }>;
  crossModuleCalls: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
  type: "flow_to" | "reads" | "writes";
  servicePairs?: Array<[string, string]>;
  callCount?: number;
}

export interface ModuleData {
  modules: ModuleNode[];
  edges: ModuleEdge[];
}

// ─── 模块归属推断 ────────────────────────────────────────────────────────────

/**
 * 从节点 ID 中提取模块名。
 *
 * 支持的 ID 格式：
 * - class:adms-api/src/main/java/... -> adms-api
 * - function:adms-api/src/main/java/... -> adms-api
 * - datasource:primary -> null (非模块节点)
 */
export function getModuleId(nodeId: string): string | null {
  if (!nodeId) return null;

  // 过滤掉特殊节点类型
  const SPECIAL_PREFIXES = ["datasource:", "database:", "topic:", "external:", "module:"];
  if (SPECIAL_PREFIXES.some((prefix) => nodeId.startsWith(prefix))) {
    return null;
  }

  // 移除前缀 (class:, function:, etc.)
  const idBody = nodeId.includes(":") ? nodeId.split(":").slice(1).join(":") : nodeId;

  // 取第一个路径段作为模块名（支持 Windows 反斜杠和 Unix 正斜杠）
  const parts = idBody.split(/[/\\]/);
  if (parts.length >= 1 && parts[0]) {
    return parts[0];
  }

  return null;
}

/**
 * 从节点 ID 中提取类名（最后一个路径段 + 类名）。
 */
export function extractClassName(nodeId: string): string {
  if (!nodeId) return "";

  // class:adms-api/src/.../UserService.java:UserService -> UserService
  const parts = nodeId.split(":");
  if (parts.length >= 3) {
    return parts[parts.length - 1];
  }

  return nodeId.split(/[/\\]/).pop() || nodeId;
}

// ─── 边聚合函数 ──────────────────────────────────────────────────────────────

/**
 * 将 Class 级 calls 边聚合为 Module 级 flow_to 边。
 */
export function aggregateToModuleLevel(
  nodes: RawNode[],
  edges: RawEdge[]
): ModuleData {
  // 1. 构建 Class ID → Module 映射
  const classToModule: Map<string, string> = new Map();
  const modules: Map<string, ModuleNode> = new Map();

  for (const node of nodes) {
    const nodeType = node.type;
    const nodeId = node.id;
    const nodeName = node.name || "";

    // 只处理特定类型
    if (!["Service", "Component", "Class", "Database"].includes(nodeType)) {
      continue;
    }

    const moduleName = getModuleId(nodeId);
    if (!moduleName) continue;

    const moduleId = `module:${moduleName}`;

    // 初始化模块
    if (!modules.has(moduleId)) {
      modules.set(moduleId, {
        id: moduleId,
        name: moduleName,
        serviceCount: 0,
        controllerCount: 0,
        repositoryCount: 0,
        services: [],
        controllers: [],
        repositories: [],
        databases: [],
        crossModuleCalls: 0,
      });
    }

    const module = modules.get(moduleId)!;

    // 分类节点
    if (nodeType === "Service") {
      module.services.push({ id: nodeId, name: nodeName });
      module.serviceCount++;
      classToModule.set(nodeId, moduleId);
    } else if (nodeType === "Component") {
      // 检查是否是 Controller
      const annotations = (node.properties?.annotations as string[]) || [];
      if (annotations.includes("@RestController") || annotations.includes("@Controller")) {
        module.controllers.push({ id: nodeId, name: nodeName });
        module.controllerCount++;
        classToModule.set(nodeId, moduleId);
      }
    } else if (nodeType === "Class") {
      // 检查是否是 Repository/Mapper
      if (["Repository", "Mapper", "Dao", "DAO"].some((p) => nodeName.includes(p))) {
        module.repositories.push({ id: nodeId, name: nodeName });
        module.repositoryCount++;
        classToModule.set(nodeId, moduleId);
      }
    }
  }

  // 2. 聚合 calls 边为 module flow_to 边
  const moduleEdgeMap: Map<string, ModuleEdge> = new Map();

  for (const edge of edges) {
    if (edge.type !== "calls") continue;

    const fromId = edge.from;
    const toId = edge.to;

    // 从 Function ID 提取 Class ID
    const fromClass = extractClassIdFromFunctionId(fromId) || fromId;
    const toClass = extractClassIdFromFunctionId(toId) || toId;

    const fromModule = classToModule.get(fromClass);
    const toModule = classToModule.get(toClass);

    // 只处理跨模块调用
    if (!fromModule || !toModule || fromModule === toModule) continue;

    const key = `${fromModule}->${toModule}`;

    if (!moduleEdgeMap.has(key)) {
      moduleEdgeMap.set(key, {
        from: fromModule,
        to: toModule,
        type: "flow_to",
        servicePairs: [],
        callCount: 0,
      });
    }

    const moduleEdge = moduleEdgeMap.get(key)!;
    moduleEdge.callCount!++;

    const fromName = extractClassName(fromClass);
    const toName = extractClassName(toClass);
    const pair: [string, string] = [fromName, toName];

    // 避免重复的 service pair
    if (!moduleEdge.servicePairs!.some((p) => p[0] === pair[0] && p[1] === pair[1])) {
      moduleEdge.servicePairs!.push(pair);
    }
  }

  // 3. 聚合 reads/writes 边
  const dbNodeMap = new Map<string, RawNode>();
  for (const node of nodes) {
    if (node.type === "Database") {
      dbNodeMap.set(node.id, node);
    }
  }

  for (const edge of edges) {
    if (edge.type !== "reads" && edge.type !== "writes") continue;

    const fromId = edge.from;
    const toId = edge.to;

    const fromModule = classToModule.get(fromId);
    if (!fromModule) continue;

    // 添加 Database 到模块
    const module = modules.get(fromModule);
    if (module && !module.databases.some((db) => db.id === toId)) {
      const dbNode = dbNodeMap.get(toId);
      module.databases.push({
        id: toId,
        name: dbNode?.name || toId.split(":").pop() || toId,
      });
    }

    // 创建 module -> database 边
    const key = `${fromModule}->${toId}:${edge.type}`;
    if (!moduleEdgeMap.has(key)) {
      moduleEdgeMap.set(key, {
        from: fromModule,
        to: toId,
        type: edge.type,
        callCount: 1,
      });
    }
  }

  // 4. 计算每个模块的跨模块调用数
  for (const [moduleId, module] of modules) {
    module.crossModuleCalls = Array.from(moduleEdgeMap.values())
      .filter((e) => e.from === moduleId && e.type === "flow_to")
      .reduce((sum, e) => sum + (e.callCount || 0), 0);
  }

  // 按 Service 数量排序
  const sortedModules = Array.from(modules.values()).sort(
    (a, b) => b.serviceCount - a.serviceCount
  );

  return {
    modules: sortedModules,
    edges: Array.from(moduleEdgeMap.values()),
  };
}

/**
 * 从 Function ID 提取 Class ID。
 *
 * function:adms-api/src/.../UserService.java:UserService.method
 * -> class:adms-api/src/.../UserService.java:UserService
 */
function extractClassIdFromFunctionId(functionId: string): string | null {
  if (!functionId.startsWith("function:")) return null;

  const parts = functionId.rsplit(".", 1);
  if (parts.length === 2) {
    return `class:${parts[0].substring(9)}`; // 移除 "function:" 前缀
  }

  return null;
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 获取跨模块边。
 */
export function getCrossModuleEdges(edges: ModuleEdge[]): ModuleEdge[] {
  return edges.filter(
    (e) => e.type === "flow_to" && e.from.startsWith("module:") && e.to.startsWith("module:")
  );
}

/**
 * 获取模块内的边。
 */
export function getIntraModuleEdges(
  edges: ModuleEdge[],
  moduleId: string
): ModuleEdge[] {
  return edges.filter(
    (e) =>
      e.from === moduleId ||
      e.to === moduleId ||
      (e.from.startsWith("module:") === false && e.to.startsWith("module:") === false)
  );
}

// 扩展 String 类型以支持 rsplit
declare global {
  interface String {
    rsplit(sep: string, maxsplit: number): string[];
  }
}

// 实现 rsplit
String.prototype.rsplit = function (sep: string, maxsplit: number): string[] {
  const split = this.split(sep);
  if (split.length <= maxsplit + 1) {
    return split;
  }
  const rest = split.slice(0, split.length - maxsplit);
  const last = split.slice(split.length - maxsplit);
  return [rest.join(sep), ...last];
};
