/**
 * 数据血缘类型定义。
 *
 * 对应 data-lineage.json 文件结构。
 */

// ─── 元数据 ───────────────────────────────────────────────────────────────────

export interface DataLineageMeta {
  name: string;
  version: string;
  generatedAt: string;
  description: string;
}

// ─── 实体 ─────────────────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  name: string;
  tableName: string;
  description: string;
  fields: string[];
  sourceFile: string;
}

// ─── 业务流程 ─────────────────────────────────────────────────────────────────

export interface FlowStep {
  step: number;
  name: string;
  description: string;
  input: string[];
  output: string[];
}

export interface BusinessFlow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  steps: FlowStep[];
  dataInputs: string[];
  dataOutputs: string[];
  relatedServices: string[];
}

// ─── 子功能 ───────────────────────────────────────────────────────────────────

export interface SubFunction {
  id: string;
  name: string;
  description: string;
  apiEndpoint: string;
  inputSource: string[];
  outputTarget: string[];
  relatedEntities: string[];
  relatedServices: string[];
  relatedDAO: string[];
}

// ─── 模块 ─────────────────────────────────────────────────────────────────────

export interface Module {
  id: string;
  name: string;
  fullName: string;
  description: string;
  icon: string;
  position: { x: number; y: number };
  color: string;
  entities: Entity[];
  businessFlows: BusinessFlow[];
  subFunctions: SubFunction[];
}

// ─── 数据流 ───────────────────────────────────────────────────────────────────

export type DataFlowNodeType = "entity" | "service" | "external" | "storage" | "view" | "trigger";

export interface DataFlowNode {
  id: string;
  name: string;
  type: DataFlowNodeType;
  module: string;
  description: string;
}

export type DataFlowEdgeType = "api" | "sync" | "trigger" | "process" | "relation" | "response" | "netty" | "aggregate";

export interface DataFlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  flowType: DataFlowEdgeType;
  description: string;
}

export interface DataFlow {
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
}

// ─── 模块依赖 ─────────────────────────────────────────────────────────────────

export type ModuleDependencyType = "data" | "config" | "service" | "auth" | "aggregate";

export interface ModuleDependency {
  from: string;
  to: string;
  type: ModuleDependencyType;
  description: string;
}

export interface ModuleDependencies {
  description: string;
  dependencies: ModuleDependency[];
}

// ─── 工作流引擎 ───────────────────────────────────────────────────────────────

export interface FlowComponent {
  id: string;
  name: string;
  description: string;
  source: string;
}

export interface FlowType {
  type: string;
  description: string;
}

export interface FlowEngine {
  description: string;
  components: FlowComponent[];
  flowTypes: FlowType[];
}

// ─── 顶层结构 ─────────────────────────────────────────────────────────────────

export interface DataLineageJSON {
  meta: DataLineageMeta;
  modules: Module[];
  dataFlow: DataFlow;
  moduleDependencies: ModuleDependencies;
  flowEngine: FlowEngine;
}
