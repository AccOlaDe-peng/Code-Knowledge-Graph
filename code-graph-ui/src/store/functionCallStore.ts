import { create } from "zustand";
import type {
  FunctionCallOverviewResponse,
  Module,
  FunctionInfo,
  CallChain,
  ViewLevel,
  ViewMode,
  ModuleSummary,
  ExternalFunction,
} from "../pages/FunctionCallGraph/types";
import httpClient from "../api/graphApi";

// ─── Store 状态 ──────────────────────────────────────────────────────────────

interface FunctionCallStore {
  // === 概览数据 ===
  overview: FunctionCallOverviewResponse | null;
  overviewLoading: boolean;
  overviewError: string | null;

  // === 模块详情 ===
  moduleDetails: Map<string, ModuleDetailData>;
  currentModuleId: string | null;
  moduleLoading: boolean;
  moduleError: string | null;

  // === 选中状态 ===
  selectedFunctionId: string | null;
  drawerFunctionId: string | null;
  currentView: ViewLevel;

  // === 调用链视图状态 ===
  viewMode: ViewMode; // 模块详情页视图模式
  callChainRootId: string | null; // 调用链根节点（选中的函数）
  collapsedNodes: Set<string>; // 折叠的虚拟节点 ID

  // === 索引（仅当前模块） ===
  callersIndex: Map<string, CallChain[]> | null;
  calleesIndex: Map<string, CallChain[]> | null;
  funcInfoIndex: Map<string, FunctionInfo> | null;

  // === Actions - 数据加载 ===
  loadOverview: (repoId: string) => Promise<void>;
  loadModuleDetail: (repoId: string, moduleId: string) => Promise<void>;
  clearData: () => void;

  // === Actions - 视图控制 ===
  setCurrentView: (view: ViewLevel) => void;
  setSelectedModule: (id: string | null) => void;
  setSelectedFunction: (id: string | null) => void;
  setDrawerFunction: (id: string | null) => void;

  // === Actions - 调用链视图 ===
  setViewMode: (mode: ViewMode) => void;
  setCallChainRoot: (funcId: string | null) => void;
  toggleCollapsedNode: (nodeId: string) => void;
  resetCallChain: () => void;

  // === 辅助方法 ===
  getCurrentModule: () => Module | null;
  getModuleSummary: (id: string) => ModuleSummary | undefined;
  getFunctionById: (id: string) => FunctionInfo | undefined;
  getCallers: (funcId: string) => CallChain[];
  getCallees: (funcId: string) => CallChain[];
  getModuleByFunctionId: (funcId: string) => Module | null;
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleDetailData {
  module: Module;
  callChains: CallChain[];
  externalFunctions: ExternalFunction[];
}

// ─── Helper 函数 ─────────────────────────────────────────────────────────────

function buildCallersIndex(callChains: CallChain[]): Map<string, CallChain[]> {
  const index = new Map<string, CallChain[]>();
  for (const chain of callChains) {
    const targetId = chain.targetFunctionId;
    if (!index.has(targetId)) {
      index.set(targetId, []);
    }
    index.get(targetId)!.push(chain);
  }
  return index;
}

function buildCalleesIndex(callChains: CallChain[]): Map<string, CallChain[]> {
  const index = new Map<string, CallChain[]>();
  for (const chain of callChains) {
    const sourceId = chain.sourceFunctionId;
    if (!index.has(sourceId)) {
      index.set(sourceId, []);
    }
    index.get(sourceId)!.push(chain);
  }
  return index;
}

function buildFuncInfoIndex(
  module: Module,
  externalFunctions: ExternalFunction[] = [],
): Map<string, FunctionInfo> {
  const index = new Map<string, FunctionInfo>();
  // 添加模块内部函数
  for (const func of module.functions) {
    index.set(func.id, func);
  }
  // 添加外部函数（跨模块调用涉及的函数）
  for (const extFunc of externalFunctions) {
    // 外部函数只包含基本信息，需要转换为 FunctionInfo 格式
    index.set(extFunc.id, {
      id: extFunc.id,
      name: extFunc.name,
      fullName: extFunc.fullName,
      className:
        extFunc.className ||
        extFunc.fullName.split(".").slice(-2, -1).join("."),
      type: extFunc.type || "service",
      visibility: "public",
      description: `外部函数 (${extFunc.moduleName})`,
      sourceFile: "",
      sourceLine: 0,
      params: [],
      returnType: { type: "void", description: "" },
      annotations: [],
      callerCount: 0,
      calleeCount: 0,
      static: false,
    });
  }
  return index;
}

function ensureFunctionsFromCallChains(
  index: Map<string, FunctionInfo>,
  callChains: CallChain[] = [],
): Map<string, FunctionInfo> {
  for (const chain of callChains) {
    if (chain.sourceFunctionId && !index.has(chain.sourceFunctionId)) {
      const fullName = chain.sourceFunctionName || chain.sourceFunctionId;
      index.set(chain.sourceFunctionId, {
        id: chain.sourceFunctionId,
        name: fullName.split(".").pop() || fullName,
        fullName,
        className: fullName.split(".").slice(-2, -1).join("."),
        type: "service",
        visibility: "public",
        description: `外部函数 (${chain.sourceModule})`,
        sourceFile: "",
        sourceLine: chain.sourceLine || 0,
        params: [],
        returnType: { type: "void", description: "" },
        annotations: [],
        callerCount: 0,
        calleeCount: 0,
        static: false,
      });
    }

    if (chain.targetFunctionId && !index.has(chain.targetFunctionId)) {
      const fullName = chain.targetFunctionName || chain.targetFunctionId;
      index.set(chain.targetFunctionId, {
        id: chain.targetFunctionId,
        name: fullName.split(".").pop() || fullName,
        fullName,
        className: fullName.split(".").slice(-2, -1).join("."),
        type: "service",
        visibility: "public",
        description: `外部函数 (${chain.targetModule})`,
        sourceFile: "",
        sourceLine: 0,
        params: [],
        returnType: { type: "void", description: "" },
        annotations: [],
        callerCount: 0,
        calleeCount: 0,
        static: false,
      });
    }
  }

  return index;
}

// ─── Store 实现 ──────────────────────────────────────────────────────────────

export const useFunctionCallStore = create<FunctionCallStore>((set, get) => ({
  // === 初始状态 ===
  overview: null,
  overviewLoading: false,
  overviewError: null,

  moduleDetails: new Map(),
  currentModuleId: null,
  moduleLoading: false,
  moduleError: null,

  selectedFunctionId: null,
  drawerFunctionId: null,
  currentView: "overview",

  // 调用链视图状态
  viewMode: "heatmap",
  callChainRootId: null,
  collapsedNodes: new Set(),

  callersIndex: null,
  calleesIndex: null,
  funcInfoIndex: null,

  // === Actions - 数据加载 ===

  loadOverview: async (repoId: string) => {
    set({ overviewLoading: true, overviewError: null });

    try {
      const response = (await httpClient.get("/graph/function-call/overview", {
        params: { repo_id: repoId },
      })) as any;

      const overview: FunctionCallOverviewResponse = {
        repo_id: response.repo_id,
        project_name: response.project_name,
        total_modules: response.total_modules,
        total_functions: response.total_functions,
        total_call_chains: response.total_call_chains,
        modules: response.modules,
        module_calls: response.module_calls,
      };

      set({
        overview,
        overviewLoading: false,
        currentView: "overview",
        currentModuleId: null,
        selectedFunctionId: null,
        drawerFunctionId: null,
        moduleDetails: new Map(),
        // 重置调用链状态
        viewMode: "heatmap",
        callChainRootId: null,
        collapsedNodes: new Set(),
        // 清除索引
        callersIndex: null,
        calleesIndex: null,
        funcInfoIndex: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "加载函数调用图概览失败";
      set({ overviewError: message, overviewLoading: false });
    }
  },

  loadModuleDetail: async (repoId: string, moduleId: string) => {
    const { moduleDetails } = get();

    // 检查缓存
    if (moduleDetails.has(moduleId)) {
      const cached = moduleDetails.get(moduleId)!;
      set({
        currentModuleId: moduleId,
        // 重建索引
        callersIndex: buildCallersIndex(cached.callChains),
        calleesIndex: buildCalleesIndex(cached.callChains),
        funcInfoIndex: ensureFunctionsFromCallChains(
          buildFuncInfoIndex(cached.module, cached.externalFunctions),
          cached.callChains,
        ),
      });
      return;
    }

    set({ moduleLoading: true, moduleError: null });

    try {
      const response = (await httpClient.get(
        `/graph/function-call/module/${moduleId}`,
        {
          params: { repo_id: repoId },
        },
      )) as any;

      const detailData: ModuleDetailData = {
        module: response.module,
        callChains: response.call_chains,
        externalFunctions: response.external_functions || [],
      };

      // 更新缓存
      const newModuleDetails = new Map(moduleDetails);
      newModuleDetails.set(moduleId, detailData);

      set({
        currentModuleId: moduleId,
        moduleDetails: newModuleDetails,
        moduleLoading: false,
        // 构建索引（包含外部函数）
        callersIndex: buildCallersIndex(detailData.callChains),
        calleesIndex: buildCalleesIndex(detailData.callChains),
        funcInfoIndex: ensureFunctionsFromCallChains(
          buildFuncInfoIndex(detailData.module, detailData.externalFunctions),
          detailData.callChains,
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载模块详情失败";
      set({ moduleError: message, moduleLoading: false });
    }
  },

  clearData: () => {
    set({
      overview: null,
      overviewLoading: false,
      overviewError: null,
      moduleDetails: new Map(),
      currentModuleId: null,
      moduleLoading: false,
      moduleError: null,
      selectedFunctionId: null,
      drawerFunctionId: null,
      currentView: "overview",
      // 重置调用链状态
      viewMode: "heatmap",
      callChainRootId: null,
      collapsedNodes: new Set(),
      callersIndex: null,
      calleesIndex: null,
      funcInfoIndex: null,
    });
  },

  // === Actions - 视图控制 ===

  setCurrentView: (view) => set({ currentView: view }),

  setSelectedModule: (id) =>
    set({
      currentModuleId: id,
      selectedFunctionId: null,
      drawerFunctionId: null,
    }),

  setSelectedFunction: (id) => set({ selectedFunctionId: id }),

  setDrawerFunction: (id) => set({ drawerFunctionId: id }),

  // === Actions - 调用链视图 ===

  setViewMode: (mode) => set({ viewMode: mode }),

  setCallChainRoot: (funcId) =>
    set({
      callChainRootId: funcId,
      collapsedNodes: new Set(), // 切换根节点时重置折叠状态
    }),

  toggleCollapsedNode: (nodeId) => {
    const { collapsedNodes } = get();
    const newSet = new Set(collapsedNodes);
    if (newSet.has(nodeId)) {
      newSet.delete(nodeId);
    } else {
      newSet.add(nodeId);
    }
    set({ collapsedNodes: newSet });
  },

  resetCallChain: () =>
    set({
      callChainRootId: null,
      collapsedNodes: new Set(),
    }),

  // === 辅助方法 ===

  getCurrentModule: () => {
    const { currentModuleId, moduleDetails } = get();
    if (!currentModuleId) return null;
    return moduleDetails.get(currentModuleId)?.module ?? null;
  },

  getModuleSummary: (id) => {
    const { overview } = get();
    return overview?.modules.find((m) => m.id === id);
  },

  getFunctionById: (id) => {
    const { funcInfoIndex } = get();
    return funcInfoIndex?.get(id);
  },

  getCallers: (funcId) => {
    const { callersIndex } = get();
    return callersIndex?.get(funcId) ?? [];
  },

  getCallees: (funcId) => {
    const { calleesIndex } = get();
    return calleesIndex?.get(funcId) ?? [];
  },

  getModuleByFunctionId: (_funcId: string) => {
    const { currentModuleId, moduleDetails } = get();
    if (!currentModuleId) return null;
    return moduleDetails.get(currentModuleId)?.module ?? null;
  },
}));
