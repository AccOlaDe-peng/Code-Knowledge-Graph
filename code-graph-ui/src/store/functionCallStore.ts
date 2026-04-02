import { create } from "zustand";
import type {
  FunctionCallOverviewResponse,
  Module,
  FunctionInfo,
  CallChain,
  TracedPath,
  ViewLevel,
  ModuleSummary,
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
  currentView: ViewLevel;

  // === 路径追踪 ===
  pathFrom: string | null;
  pathTo: string | null;
  tracedPaths: TracedPath[] | null;
  selectedPathIndex: number | null;
  tracingPath: boolean;

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

  // === Actions - 路径追踪 ===
  setPathFrom: (funcId: string | null) => void;
  setPathTo: (funcId: string | null) => void;
  tracePath: (repoId: string) => Promise<void>;
  setSelectedPathIndex: (index: number | null) => void;
  clearPathTrace: () => void;

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

function buildFuncInfoIndex(module: Module): Map<string, FunctionInfo> {
  const index = new Map<string, FunctionInfo>();
  for (const func of module.functions) {
    index.set(func.id, func);
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
  currentView: "overview",

  pathFrom: null,
  pathTo: null,
  tracedPaths: null,
  selectedPathIndex: null,
  tracingPath: false,

  callersIndex: null,
  calleesIndex: null,
  funcInfoIndex: null,

  // === Actions - 数据加载 ===

  loadOverview: async (repoId: string) => {
    set({ overviewLoading: true, overviewError: null });

    try {
      const response = await httpClient.get("/graph/function-call/overview", {
        params: { repo_id: repoId },
      }) as any;

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
        moduleDetails: new Map(),
        // 清除索引
        callersIndex: null,
        calleesIndex: null,
        funcInfoIndex: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载函数调用图概览失败";
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
        funcInfoIndex: buildFuncInfoIndex(cached.module),
      });
      return;
    }

    set({ moduleLoading: true, moduleError: null });

    try {
      const response = await httpClient.get(`/graph/function-call/module/${moduleId}`, {
        params: { repo_id: repoId },
      }) as any;

      const detailData: ModuleDetailData = {
        module: response.module,
        callChains: response.call_chains,
      };

      // 更新缓存
      const newModuleDetails = new Map(moduleDetails);
      newModuleDetails.set(moduleId, detailData);

      set({
        currentModuleId: moduleId,
        moduleDetails: newModuleDetails,
        moduleLoading: false,
        // 构建索引
        callersIndex: buildCallersIndex(detailData.callChains),
        calleesIndex: buildCalleesIndex(detailData.callChains),
        funcInfoIndex: buildFuncInfoIndex(detailData.module),
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
      currentView: "overview",
      pathFrom: null,
      pathTo: null,
      tracedPaths: null,
      selectedPathIndex: null,
      tracingPath: false,
      callersIndex: null,
      calleesIndex: null,
      funcInfoIndex: null,
    });
  },

  // === Actions - 视图控制 ===

  setCurrentView: (view) => set({ currentView: view }),

  setSelectedModule: (id) => set({
    currentModuleId: id,
    selectedFunctionId: null,
  }),

  setSelectedFunction: (id) => set({ selectedFunctionId: id }),

  // === Actions - 路径追踪 ===

  setPathFrom: (funcId) => set({ pathFrom: funcId }),
  setPathTo: (funcId) => set({ pathTo: funcId }),

  tracePath: async (repoId: string) => {
    const { pathFrom, pathTo } = get();
    if (!pathFrom || !pathTo) {
      return;
    }

    set({ tracingPath: true, tracedPaths: null, selectedPathIndex: null });

    try {
      const response = await httpClient.get("/graph/function-call/path", {
        params: {
          repo_id: repoId,
          from_func: pathFrom,
          to_func: pathTo,
        },
      }) as any;

      set({
        tracedPaths: response.paths,
        tracingPath: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "路径追踪失败";
      set({ overviewError: message, tracingPath: false });
    }
  },

  setSelectedPathIndex: (index) => set({ selectedPathIndex: index }),

  clearPathTrace: () => {
    set({
      pathFrom: null,
      pathTo: null,
      tracedPaths: null,
      selectedPathIndex: null,
    });
  },

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
