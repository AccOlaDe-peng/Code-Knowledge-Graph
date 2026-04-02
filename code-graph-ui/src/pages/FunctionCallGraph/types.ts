/**
 * 函数调用图类型定义
 */

// ─── 函数类型 ────────────────────────────────────────────────────────────────

export type FunctionType =
  | "service"
  | "controller"
  | "repository"
  | "dto"
  | "entity"
  | "util"
  | "handler"
  | "config"
  | "mapper";

export type Visibility = "public" | "private" | "protected";

// ─── 函数参数和返回值 ────────────────────────────────────────────────────────

export interface FunctionParam {
  name: string;
  type: string;
  description?: string;
}

export interface FunctionReturnType {
  type: string;
  description?: string;
}

// ─── 核心数据结构 ────────────────────────────────────────────────────────────

export interface FunctionInfo {
  id: string;
  name: string;
  className: string;
  fullName: string;
  type: FunctionType;
  visibility: Visibility;
  description: string;
  sourceFile: string;
  sourceLine: number;
  params: FunctionParam[];
  returnType: FunctionReturnType;
  annotations: string[];
  callerCount: number;
  calleeCount: number;
  static: boolean;
}

export interface Module {
  id: string;
  name: string;
  displayName: string;
  description: string;
  path: string;
  functionCount: number;
  callChainCount: number;
  functions: FunctionInfo[];
}

export interface CallChain {
  sourceModule: string;
  sourceModuleId: string;
  sourceFunctionId: string;
  sourceFunctionName: string;
  targetModule: string;
  targetModuleId: string;
  targetFunctionId: string;
  targetFunctionName: string;
  callType: "direct" | "interface";
  sourceLine: number;
}

export interface ModuleCall {
  from: string;
  to: string;
  count: number;
}

// ─── API 响应类型 ────────────────────────────────────────────────────────────

// 模块概览（不含函数列表）
export interface ModuleSummary {
  id: string;
  name: string;
  displayName: string;
  description: string;
  path: string;
  functionCount: number;
  callChainCount: number;
}

// 概览响应（轻量级）
export interface FunctionCallOverviewResponse {
  repo_id: string;
  project_name: string;
  total_modules: number;
  total_functions: number;
  total_call_chains: number;
  modules: ModuleSummary[];
  module_calls: ModuleCall[];
}

// 外部函数信息（跨模块调用涉及）
export interface ExternalFunction {
  id: string;
  name: string;  // 函数短名
  fullName: string;  // 全限定名
  moduleId: string;
  moduleName: string;
  type?: FunctionType;
  className?: string;
}

// 模块详情响应
export interface ModuleDetailResponse {
  module: Module;
  call_chains: CallChain[];
  external_functions: ExternalFunction[];
}

export interface FunctionCallGraphResponse {
  repo_id: string;
  project_name: string;
  total_modules: number;
  total_functions: number;
  total_call_chains: number;
  modules: Module[];
  call_chains: CallChain[];
  module_calls: ModuleCall[];
}

// ─── 前端视图状态 ────────────────────────────────────────────────────────────

export type ViewLevel = "overview" | "detail";

export interface FunctionCallStoreState {
  // 数据
  data: FunctionCallGraphResponse | null;
  loading: boolean;
  error: string | null;

  // 视图状态
  currentView: ViewLevel;
  selectedModuleId: string | null;
  selectedFunctionId: string | null;

  // 索引（缓存）
  callersIndex: Map<string, CallChain[]> | null;
  calleesIndex: Map<string, CallChain[]> | null;
  funcToModuleIndex: Map<string, Module> | null;
  funcInfoIndex: Map<string, FunctionInfo> | null;
}

// ─── 颜色配置 ─────────────────────────────────────────────────────────────────

export const FUNCTION_TYPE_COLORS: Record<FunctionType, { bg: string; border: string; text: string }> = {
  service: { bg: "#0d1117", border: "#00d4ff", text: "#00d4ff" },
  controller: { bg: "#0d1117", border: "#00f084", text: "#00f084" },
  repository: { bg: "#0d1117", border: "#b08eff", text: "#b08eff" },
  dto: { bg: "#0d1117", border: "#ffc145", text: "#ffc145" },
  entity: { bg: "#0d1117", border: "#ff66cc", text: "#ff66cc" },
  handler: { bg: "#0d1117", border: "#ff6b6b", text: "#ff6b6b" },
  util: { bg: "#0d1117", border: "#7888a8", text: "#7888a8" },
  config: { bg: "#0d1117", border: "#5a6a8a", text: "#5a6a8a" },
  mapper: { bg: "#0d1117", border: "#88a8c8", text: "#88a8c8" },
};

export const EDGE_COLORS = {
  same_module: "#00d4ff",
  cross_module: "#ffc145",
  interface_call: "#b08eff",
};

// ─── 布局配置 ─────────────────────────────────────────────────────────────────

export const LAYOUT_CONFIG = {
  // Dagre 布局
  dagre: {
    rankdir: "LR" as const, // Left to Right
    nodesep: 60,
    ranksep: 120,
    marginx: 50,
    marginy: 50,
  },
  // 力导向布局
  force: {
    edgeStrength: 0.2,
    nodeStrength: -100,
    gravity: 0.1,
  },
  // 模块总览节点大小
  moduleNode: {
    minWidth: 160,
    maxWidth: 280,
    minHeight: 80,
    maxHeight: 160,
  },
  // 函数节点大小
  functionNode: {
    width: 180,
    height: 60,
  },
};
