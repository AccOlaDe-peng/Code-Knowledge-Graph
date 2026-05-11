/**
 * 分层架构图类型定义
 *
 * 对应 adms-architecture.json 的数据结构
 */

// ─── 技术栈 ───────────────────────────────────────────────────────────────────

export type TechStack = {
  framework?: string
  web?: string
  orm?: string
  database?: string
  cache?: string
  mq?: string
  netty?: string
  job?: string
  [key: string]: string | undefined
}

// ─── 节点 ──────────────────────────────────────────────────────────────────────

export type ArchitectureNode = {
  id: string
  name: string
  displayName: string
  source?: string
  description?: string      // 功能说明（注释提取）
  isEntryPoint?: boolean    // 入口节点标记
  keyMethods?: string[]     // 关键方法展示（备选）
  methods?: string[]        // 方法列表
  functions?: string[]
  dependencies?: string[]
  endpoints?: string[]
  attributes?: string[]
}

// ─── 层 ────────────────────────────────────────────────────────────────────────

export type ArchitectureLayer = {
  id: string
  name: string
  alias?: string
  description?: string
  source?: string
  technology?: string
  nodes: ArchitectureNode[]
}

// ─── 数据流 ────────────────────────────────────────────────────────────────────

export type DataFlow = {
  name: string
  path: string[]
}

export type DataFlowConfig = {
  description?: string
  flows: DataFlow[]
}

// ─── 模块依赖 ──────────────────────────────────────────────────────────────────

export type ModuleDependency = {
  name: string
  type?: string
  dependencies: string[]
}

export type ModuleDependenciesConfig = {
  description?: string
  modules: ModuleDependency[]
}

// ─── 支持的数据库 ──────────────────────────────────────────────────────────────

export type SupportedDatabase = {
  name: string
  entity: string
  features?: string[]
}

// ─── 完整架构数据 ──────────────────────────────────────────────────────────────

export type ArchitectureData = {
  name: string
  fullName?: string
  description?: string
  version?: string
  techStack?: TechStack
  layers: ArchitectureLayer[]
  dataFlow?: DataFlowConfig
  moduleDependencies?: ModuleDependenciesConfig
  supportedDatabases?: SupportedDatabase[]
}

// ─── 层配色方案 ────────────────────────────────────────────────────────────────

export const LAYER_COLORS = {
  presentation: { bg: '#1a2a4a', border: '#00d4ff', accent: '#00d4ff' },
  service: { bg: '#1a3a3a', border: '#00f084', accent: '#00f084' },
  'flow-engine': { bg: '#2a2a3a', border: '#b08eff', accent: '#b08eff' },
  domain: { bg: '#2a3a2a', border: '#00f084', accent: '#00f084' },
  repository: { bg: '#1a2a3a', border: '#00d4ff', accent: '#00d4ff' },
  infrastructure: { bg: '#2a1a2a', border: '#ff6b9d', accent: '#ff6b9d' },
  data: { bg: '#3a2a1a', border: '#ffc145', accent: '#ffc145' },
} as const

export type LayerId = keyof typeof LAYER_COLORS
