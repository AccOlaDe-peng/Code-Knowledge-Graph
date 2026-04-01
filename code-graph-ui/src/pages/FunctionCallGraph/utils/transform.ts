/**
 * 数据转换工具
 */

import type {
  Module,
  FunctionInfo,
  CallChain,
  ModuleCall,
} from "../types";

/**
 * 构建函数调用者索引
 * 返回 Map<targetFunctionId, CallChain[]>
 */
export function buildCallersIndex(callChains: CallChain[]): Map<string, CallChain[]> {
  const index = new Map<string, CallChain[]>();
  for (const chain of callChains) {
    const key = chain.targetFunctionId;
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key)!.push(chain);
  }
  return index;
}

/**
 * 构建函数被调用索引
 * 返回 Map<sourceFunctionId, CallChain[]>
 */
export function buildCalleesIndex(callChains: CallChain[]): Map<string, CallChain[]> {
  const index = new Map<string, CallChain[]>();
  for (const chain of callChains) {
    const key = chain.sourceFunctionId;
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key)!.push(chain);
  }
  return index;
}

/**
 * 构建函数到模块的映射
 */
export function buildFuncToModuleIndex(modules: Module[]): Map<string, Module> {
  const index = new Map<string, Module>();
  for (const module of modules) {
    for (const func of module.functions) {
      index.set(func.id, module);
    }
  }
  return index;
}

/**
 * 构建函数 ID 到函数信息的映射
 */
export function buildFuncInfoIndex(modules: Module[]): Map<string, FunctionInfo> {
  const index = new Map<string, FunctionInfo>();
  for (const module of modules) {
    for (const func of module.functions) {
      index.set(func.id, func);
    }
  }
  return index;
}

/**
 * 计算模块热度（0-1）
 * 基于函数数量和调用链数量
 */
export function calculateModuleHeat(
  module: Module,
  maxFunctions: number,
  maxCallChains: number
): number {
  const funcRatio = module.functionCount / maxFunctions;
  const chainRatio = module.callChainCount / maxCallChains;
  return Math.min(1, (funcRatio * 0.4 + chainRatio * 0.6));
}

/**
 * 过滤模块内函数
 */
export function filterFunctions(
  functions: FunctionInfo[],
  filters: {
    searchText?: string;
    types?: string[];
    minCallers?: number;
    minCallees?: number;
  }
): FunctionInfo[] {
  let result = [...functions];

  if (filters.searchText) {
    const search = filters.searchText.toLowerCase();
    result = result.filter(
      (f) =>
        f.name.toLowerCase().includes(search) ||
        f.fullName.toLowerCase().includes(search) ||
        f.className.toLowerCase().includes(search)
    );
  }

  if (filters.types && filters.types.length > 0) {
    result = result.filter((f) => filters.types!.includes(f.type));
  }

  if (filters.minCallers !== undefined) {
    result = result.filter((f) => f.callerCount >= filters.minCallers!);
  }

  if (filters.minCallees !== undefined) {
    result = result.filter((f) => f.calleeCount >= filters.minCallees!);
  }

  return result;
}

/**
 * 获取模块内调用链
 */
export function getModuleCallChains(
  moduleId: string,
  callChains: CallChain[]
): CallChain[] {
  return callChains.filter(
    (c) => c.sourceModuleId === moduleId || c.targetModuleId === moduleId
  );
}

/**
 * 获取模块间调用边数据
 */
export function getModuleCallEdges(
  moduleCalls: ModuleCall[],
  modules: Module[]
): Array<{
  from: Module;
  to: Module;
  count: number;
}> {
  const moduleMap = new Map<string, Module>();
  for (const m of modules) {
    moduleMap.set(m.id, m);
  }

  return moduleCalls
    .map((mc) => ({
      from: moduleMap.get(mc.from),
      to: moduleMap.get(mc.to),
      count: mc.count,
    }))
    .filter((e): e is { from: Module; to: Module; count: number } =>
      e.from !== undefined && e.to !== undefined
    );
}
