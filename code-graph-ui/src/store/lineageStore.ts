/**
 * 血缘视图状态管理 Store。
 *
 * 管理三层视图的状态：
 * - 层级 1: 模块级主图
 * - 层级 2: 模块内视图
 * - 层级 3: 详细血缘
 *
 * 视图模式：
 * - tech: 技术架构视图（按技术模块聚合）
 * - business: 业务领域视图（按业务领域聚合）
 */
import { create } from "zustand";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type LineageLevel = "module" | "service" | "detail";
export type ViewMode = "tech" | "business";

export interface ModuleInfo {
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

export interface ServiceInfo {
  id: string;
  name: string;
  type: string;
}

export interface DomainDefinition {
  id: string;
  key: string;
  name: string;
  aliases: string[];
  color: string;
  icon?: string;
  description?: string;
}

export interface DomainConfig {
  repoId: string;
  version: number;
  lastModified: string;
  domains: DomainDefinition[];
}

export interface InferredDomain {
  key: string;
  suggestedName: string;
  confidence: number;
  nodeCount: number;
  relatedKeys: string[];
  sampleNodes: string[];
  suggestedColor: string;
}

export interface LineageState {
  // 视图模式
  viewMode: ViewMode;

  // 视图层级
  level: LineageLevel;

  // 当前选中的模块/服务
  selectedModule: ModuleInfo | null;
  selectedService: ServiceInfo | null;

  // 领域配置
  domainConfig: DomainConfig | null;
  inferredDomains: InferredDomain[];
  domainLoading: boolean;

  // 导航 actions
  navigateToModule: (module: ModuleInfo) => void;
  navigateToService: (service: ServiceInfo) => void;
  navigateBack: () => void;
  reset: () => void;

  // 视图模式 actions
  setViewMode: (mode: ViewMode) => void;
  setDomainConfig: (config: DomainConfig | null) => void;
  setInferredDomains: (domains: InferredDomain[]) => void;
  setDomainLoading: (loading: boolean) => void;
}

// ─── Store 实现 ──────────────────────────────────────────────────────────────

export const useLineageStore = create<LineageState>((set, get) => ({
  // 初始状态
  viewMode: "tech",
  level: "module",
  selectedModule: null,
  selectedService: null,
  domainConfig: null,
  inferredDomains: [],
  domainLoading: false,

  // 导航到模块内视图
  navigateToModule: (module: ModuleInfo) => {
    set({
      level: "service",
      selectedModule: module,
      selectedService: null, // 清除之前选中的服务
    });
  },

  // 导航到服务详细视图
  navigateToService: (service: ServiceInfo) => {
    set({
      level: "detail",
      selectedService: service,
    });
  },

  // 返回上一层
  navigateBack: () => {
    const { level } = get();

    if (level === "detail") {
      // 从详细视图返回模块内视图
      set({
        level: "service",
        selectedService: null,
      });
    } else if (level === "service") {
      // 从模块内视图返回模块主图
      set({
        level: "module",
        selectedModule: null,
        selectedService: null,
      });
    }
  },

  // 重置到初始状态
  reset: () => {
    set({
      level: "module",
      selectedModule: null,
      selectedService: null,
    });
  },

  // 设置视图模式
  setViewMode: (mode: ViewMode) => {
    set({
      viewMode: mode,
      // 切换视图模式时重置层级
      level: "module",
      selectedModule: null,
      selectedService: null,
    });
  },

  // 设置领域配置
  setDomainConfig: (config: DomainConfig | null) => {
    set({ domainConfig: config });
  },

  // 设置推断的领域
  setInferredDomains: (domains: InferredDomain[]) => {
    set({ inferredDomains: domains });
  },

  // 设置领域加载状态
  setDomainLoading: (loading: boolean) => {
    set({ domainLoading: loading });
  },
}));

// ─── 选择器 ──────────────────────────────────────────────────────────────────

export const selectLevel = (state: LineageState) => state.level;
export const selectViewMode = (state: LineageState) => state.viewMode;
export const selectSelectedModule = (state: LineageState) => state.selectedModule;
export const selectSelectedService = (state: LineageState) => state.selectedService;
export const selectDomainConfig = (state: LineageState) => state.domainConfig;
export const selectInferredDomains = (state: LineageState) => state.inferredDomains;

// ─── 辅助 Hooks ──────────────────────────────────────────────────────────────

/**
 * 获取当前视图层级的信息。
 */
export function useLineageLevel() {
  const level = useLineageStore(selectLevel);
  const selectedModule = useLineageStore(selectSelectedModule);
  const selectedService = useLineageStore(selectSelectedService);

  return {
    level,
    selectedModule,
    selectedService,
    isModuleView: level === "module",
    isServiceView: level === "service",
    isDetailView: level === "detail",
  };
}

/**
 * 获取视图模式信息。
 */
export function useViewMode() {
  const viewMode = useLineageStore(selectViewMode);
  const setViewMode = useLineageStore((s) => s.setViewMode);

  return {
    viewMode,
    isTechView: viewMode === "tech",
    isBusinessView: viewMode === "business",
    setViewMode,
  };
}

/**
 * 获取导航操作。
 */
export function useLineageNavigation() {
  const navigateToModule = useLineageStore((s) => s.navigateToModule);
  const navigateToService = useLineageStore((s) => s.navigateToService);
  const navigateBack = useLineageStore((s) => s.navigateBack);
  const reset = useLineageStore((s) => s.reset);

  return {
    navigateToModule,
    navigateToService,
    navigateBack,
    reset,
  };
}

/**
 * 获取领域配置状态。
 */
export function useDomainConfig() {
  const domainConfig = useLineageStore(selectDomainConfig);
  const inferredDomains = useLineageStore(selectInferredDomains);
  const domainLoading = useLineageStore((s) => s.domainLoading);
  const setDomainConfig = useLineageStore((s) => s.setDomainConfig);
  const setInferredDomains = useLineageStore((s) => s.setInferredDomains);
  const setDomainLoading = useLineageStore((s) => s.setDomainLoading);

  return {
    domainConfig,
    inferredDomains,
    domainLoading,
    setDomainConfig,
    setInferredDomains,
    setDomainLoading,
  };
}
