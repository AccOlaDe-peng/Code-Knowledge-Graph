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

// ─── 领域交互类型 ─────────────────────────────────────────────────────────────

export type DetailLevel = "compact" | "standard" | "detailed";
export type DomainLevel = "main" | "subgraph";

export interface DomainInfo {
  id: string;
  key: string;
  name: string;
  color: string;
  nodeCount: number;
  serviceCount: number;
  controllerCount: number;
  repositoryCount: number;
  crossDomainCalls: number;
  nodeIds: string[];
}

export interface DomainDescription {
  domainId: string;
  summary: string;
  coreServices: string[];
  dataFlowPattern: string;
  generatedAt: string;
  confidence: number;
}

export interface NodeDetail {
  nodeId: string;
  name: string;
  type: string;
  file: string;
  signature?: string;
  line?: number;
  endLine?: number;
  aiDescription?: string;
  codeSnippet?: CodeSnippet;
  callCount: number;
  calledByCount: number;
  dependencies: string[];
  generatedAt?: string;
}

export interface CodeSnippet {
  language: string;
  content: string;
  startLine: number;
  highlightLines: number[];
}

export interface InfoPanelData {
  type: "domain" | "node" | null;
  data: DomainDescription | NodeDetail | null;
  loading: boolean;
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

  // 领域交互状态（新增）
  selectedDomain: DomainInfo | null;
  domainLevel: DomainLevel;
  infoPanelData: InfoPanelData;
  domainDrawerVisible: boolean;
  nodeDrawerVisible: boolean;
  domainDrawerData: DomainDescription | null;
  nodeDrawerData: NodeDetail | null;
  detailLevel: DetailLevel;

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

  // 领域交互 actions（新增）
  setSelectedDomain: (domain: DomainInfo | null) => void;
  setDomainLevel: (level: DomainLevel) => void;
  setInfoPanelData: (data: InfoPanelData) => void;
  openDomainDrawer: (data: DomainDescription) => void;
  closeDomainDrawer: () => void;
  openNodeDrawer: (data: NodeDetail) => void;
  closeNodeDrawer: () => void;
  setDetailLevel: (level: DetailLevel) => void;
  navigateToDomain: (domain: DomainInfo) => void;
  navigateFromDomain: () => void;
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

  // 领域交互初始状态
  selectedDomain: null,
  domainLevel: "main",
  infoPanelData: { type: null, data: null, loading: false },
  domainDrawerVisible: false,
  nodeDrawerVisible: false,
  domainDrawerData: null,
  nodeDrawerData: null,
  detailLevel: "standard",

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
      selectedDomain: null,
      domainLevel: "main",
      infoPanelData: { type: null, data: null, loading: false },
      domainDrawerVisible: false,
      nodeDrawerVisible: false,
      domainDrawerData: null,
      nodeDrawerData: null,
      detailLevel: "standard",
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
      selectedDomain: null,
      domainLevel: "main",
      infoPanelData: { type: null, data: null, loading: false },
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

  // ─── 领域交互 Actions ─────────────────────────────────────────────────────

  // 设置选中的领域
  setSelectedDomain: (domain: DomainInfo | null) => {
    set({ selectedDomain: domain });
  },

  // 设置领域层级
  setDomainLevel: (level: DomainLevel) => {
    set({ domainLevel: level });
  },

  // 设置信息面板数据
  setInfoPanelData: (data: InfoPanelData) => {
    set({ infoPanelData: data });
  },

  // 打开领域抽屉
  openDomainDrawer: (data: DomainDescription) => {
    set({
      domainDrawerVisible: true,
      domainDrawerData: data,
    });
  },

  // 关闭领域抽屉
  closeDomainDrawer: () => {
    set({
      domainDrawerVisible: false,
    });
  },

  // 打开节点抽屉
  openNodeDrawer: (data: NodeDetail) => {
    set({
      nodeDrawerVisible: true,
      nodeDrawerData: data,
    });
  },

  // 关闭节点抽屉
  closeNodeDrawer: () => {
    set({
      nodeDrawerVisible: false,
    });
  },

  // 设置详细度
  setDetailLevel: (level: DetailLevel) => {
    set({ detailLevel: level });
  },

  // 导航到领域子图
  navigateToDomain: (domain: DomainInfo) => {
    set({
      domainLevel: "subgraph",
      selectedDomain: domain,
      infoPanelData: { type: null, data: null, loading: false },
    });
  },

  // 从领域子图返回
  navigateFromDomain: () => {
    set({
      domainLevel: "main",
      selectedDomain: null,
      infoPanelData: { type: null, data: null, loading: false },
      domainDrawerVisible: false,
      nodeDrawerVisible: false,
    });
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

/**
 * 获取领域交互状态。
 */
export function useDomainInteraction() {
  const selectedDomain = useLineageStore((s) => s.selectedDomain);
  const domainLevel = useLineageStore((s) => s.domainLevel);
  const infoPanelData = useLineageStore((s) => s.infoPanelData);
  const domainDrawerVisible = useLineageStore((s) => s.domainDrawerVisible);
  const nodeDrawerVisible = useLineageStore((s) => s.nodeDrawerVisible);
  const domainDrawerData = useLineageStore((s) => s.domainDrawerData);
  const nodeDrawerData = useLineageStore((s) => s.nodeDrawerData);
  const detailLevel = useLineageStore((s) => s.detailLevel);

  const setSelectedDomain = useLineageStore((s) => s.setSelectedDomain);
  const setDomainLevel = useLineageStore((s) => s.setDomainLevel);
  const setInfoPanelData = useLineageStore((s) => s.setInfoPanelData);
  const openDomainDrawer = useLineageStore((s) => s.openDomainDrawer);
  const closeDomainDrawer = useLineageStore((s) => s.closeDomainDrawer);
  const openNodeDrawer = useLineageStore((s) => s.openNodeDrawer);
  const closeNodeDrawer = useLineageStore((s) => s.closeNodeDrawer);
  const setDetailLevel = useLineageStore((s) => s.setDetailLevel);
  const navigateToDomain = useLineageStore((s) => s.navigateToDomain);
  const navigateFromDomain = useLineageStore((s) => s.navigateFromDomain);

  return {
    selectedDomain,
    domainLevel,
    infoPanelData,
    domainDrawerVisible,
    nodeDrawerVisible,
    domainDrawerData,
    nodeDrawerData,
    detailLevel,
    isMainView: domainLevel === "main",
    isSubgraphView: domainLevel === "subgraph",
    setSelectedDomain,
    setDomainLevel,
    setInfoPanelData,
    openDomainDrawer,
    closeDomainDrawer,
    openNodeDrawer,
    closeNodeDrawer,
    setDetailLevel,
    navigateToDomain,
    navigateFromDomain,
  };
}

/**
 * 获取信息面板状态。
 */
export function useInfoPanel() {
  const infoPanelData = useLineageStore((s) => s.infoPanelData);
  const setInfoPanelData = useLineageStore((s) => s.setInfoPanelData);
  const openDomainDrawer = useLineageStore((s) => s.openDomainDrawer);
  const openNodeDrawer = useLineageStore((s) => s.openNodeDrawer);

  return {
    infoPanelData,
    setInfoPanelData,
    openDomainDrawer,
    openNodeDrawer,
    hasData: infoPanelData.type !== null && infoPanelData.data !== null,
    isDomain: infoPanelData.type === "domain",
    isNode: infoPanelData.type === "node",
  };
}

/**
 * 获取详细度状态。
 */
export function useDetailLevel() {
  const detailLevel = useLineageStore((s) => s.detailLevel);
  const setDetailLevel = useLineageStore((s) => s.setDetailLevel);

  return {
    detailLevel,
    setDetailLevel,
    isCompact: detailLevel === "compact",
    isStandard: detailLevel === "standard",
    isDetailed: detailLevel === "detailed",
  };
}
