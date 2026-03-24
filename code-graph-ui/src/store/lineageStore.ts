/**
 * 血缘视图状态管理 Store。
 *
 * 管理三层视图的状态：
 * - 层级 1: 模块级主图
 * - 层级 2: 模块内视图
 * - 层级 3: 详细血缘
 */
import { create } from "zustand";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type LineageLevel = "module" | "service" | "detail";

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

export interface LineageState {
  // 视图层级
  level: LineageLevel;

  // 当前选中的模块/服务
  selectedModule: ModuleInfo | null;
  selectedService: ServiceInfo | null;

  // 导航 actions
  navigateToModule: (module: ModuleInfo) => void;
  navigateToService: (service: ServiceInfo) => void;
  navigateBack: () => void;
  reset: () => void;
}

// ─── Store 实现 ──────────────────────────────────────────────────────────────

export const useLineageStore = create<LineageState>((set, get) => ({
  // 初始状态
  level: "module",
  selectedModule: null,
  selectedService: null,

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
}));

// ─── 选择器 ──────────────────────────────────────────────────────────────────

export const selectLevel = (state: LineageState) => state.level;
export const selectSelectedModule = (state: LineageState) => state.selectedModule;
export const selectSelectedService = (state: LineageState) => state.selectedService;

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
