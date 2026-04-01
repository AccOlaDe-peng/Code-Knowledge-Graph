import { create } from "zustand";
import type {
  FunctionCallGraphResponse,
  Module,
  FunctionInfo,
  CallChain,
  TracedPath,
  ViewLevel,
} from "../pages/FunctionCallGraph/types";
import httpClient from "../api/graphApi";

// ─── Store 状态 ──────────────────────────────────────────────────────────────

interface FunctionCallStore {
  // 数据
  data: FunctionCallGraphResponse | null;
  loading: boolean;
  error: string | null;

  // 视图状态
  currentView: ViewLevel;
  selectedModuleId: string | null;
  selectedFunctionId: string | null;

  // 路径追踪
  pathFrom: string | null;
  pathTo: string | null;
  tracedPaths: TracedPath[] | null;
  selectedPathIndex: number | null;
  tracingPath: boolean;

  // 索引（缓存）
  callersIndex: Map<string, CallChain[]> | null;
  calleesIndex: Map<string, CallChain[]> | null;
  funcToModuleIndex: Map<string, Module> | null;
  funcInfoIndex: Map<string, FunctionInfo> | null;

  // Actions - 数据加载
  loadData: (repoId: string) => Promise<void>;
  clearData: () => void;

  // Actions - 视图控制
  setCurrentView: (view: ViewLevel) => void;
  setSelectedModule: (id: string | null) => void;
  setSelectedFunction: (id: string | null) => void;

  // Actions - 路径追踪
  setPathFrom: (funcId: string | null) => void;
  setPathTo: (funcId: string | null) => void;
  tracePath: (repoId: string) => Promise<void>;
  setSelectedPathIndex: (index: number | null) => void;
  clearPathTrace: () => void;

  // Actions - 索引构建
  buildIndexes: () => void;

  // 辅助方法
  getModuleById: (id: string) => Module | undefined;
  getFunctionById: (id: string) => FunctionInfo | undefined;
  getCallers: (funcId: string) => CallChain[];
  getCallees: (funcId: string) => CallChain[];
  getModuleByFunctionId: (funcId: string) => Module | undefined;
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

function buildFuncToModuleIndex(modules: Module[]): Map<string, Module> {
  const index = new Map<string, Module>();
  for (const module of modules) {
    for (const func of module.functions) {
      index.set(func.id, module);
    }
  }
  return index;
}

function buildFuncInfoIndex(modules: Module[]): Map<string, FunctionInfo> {
  const index = new Map<string, FunctionInfo>();
  for (const module of modules) {
    for (const func of module.functions) {
      index.set(func.id, func);
    }
  }
  return index;
}

// ─── Store 实现 ──────────────────────────────────────────────────────────────

export const useFunctionCallStore = create<FunctionCallStore>((set, get) => ({
  // 初始状态
  data: null,
  loading: false,
  error: null,
  currentView: "overview",
  selectedModuleId: null,
  selectedFunctionId: null,
  pathFrom: null,
  pathTo: null,
  tracedPaths: null,
  selectedPathIndex: null,
  tracingPath: false,
  callersIndex: null,
  calleesIndex: null,
  funcToModuleIndex: null,
  funcInfoIndex: null,

  // 数据加载
  loadData: async (repoId: string) => {
    set({ loading: true, error: null });

    try {
      // httpClient 拦截器已经返回 res.data，使用类型断言
      const response = await httpClient.get("/graph/function-call", {
        params: { repo_id: repoId },
      }) as any;

      const data: FunctionCallGraphResponse = {
        repo_id: response.repo_id,
        project_name: response.project_name,
        total_modules: response.total_modules,
        total_functions: response.total_functions,
        total_call_chains: response.total_call_chains,
        modules: response.modules,
        call_chains: response.call_chains,
        module_calls: response.module_calls,
      };

      set({ data, loading: false });

      // 构建索引
      get().buildIndexes();

      // 重置视图状态
      set({
        currentView: "overview",
        selectedModuleId: null,
        selectedFunctionId: null,
        pathFrom: null,
        pathTo: null,
        tracedPaths: null,
        selectedPathIndex: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载函数调用图失败";
      set({ error: message, loading: false });
    }
  },

  clearData: () => {
    set({
      data: null,
      loading: false,
      error: null,
      currentView: "overview",
      selectedModuleId: null,
      selectedFunctionId: null,
      pathFrom: null,
      pathTo: null,
      tracedPaths: null,
      selectedPathIndex: null,
      callersIndex: null,
      calleesIndex: null,
      funcToModuleIndex: null,
      funcInfoIndex: null,
    });
  },

  // 视图控制
  setCurrentView: (view) => set({ currentView: view }),
  setSelectedModule: (id) => set({ selectedModuleId: id, selectedFunctionId: null }),
  setSelectedFunction: (id) => set({ selectedFunctionId: id }),

  // 路径追踪
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
      set({ error: message, tracingPath: false });
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

  // 索引构建
  buildIndexes: () => {
    const { data } = get();
    if (!data) return;

    const callersIndex = buildCallersIndex(data.call_chains);
    const calleesIndex = buildCalleesIndex(data.call_chains);
    const funcToModuleIndex = buildFuncToModuleIndex(data.modules);
    const funcInfoIndex = buildFuncInfoIndex(data.modules);

    set({
      callersIndex,
      calleesIndex,
      funcToModuleIndex,
      funcInfoIndex,
    });
  },

  // 辅助方法
  getModuleById: (id) => {
    const { data } = get();
    return data?.modules.find((m) => m.id === id);
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

  getModuleByFunctionId: (funcId) => {
    const { funcToModuleIndex } = get();
    return funcToModuleIndex?.get(funcId);
  },
}));
