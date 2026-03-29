/**
 * 节点类型颜色映射
 *
 * 分组策略：
 * - Cyan (190°): 代码结构 - Repository, Module, File
 * - Green (150°): 服务层 - Service, API, APIEndpoint, Component
 * - Purple (270°): 数据/类 - Class, Database, Table, DataObject, DataSource, DataSink
 * - Amber (40°): 事件/流程 - Event, Topic, EventHandler, MessageQueue, Flow, BusinessFlow, Pipeline
 * - Blue (220°): 架构层 - Layer, Domain, BoundedContext, DomainEntity
 * - Red (350°): 外部系统 - ExternalAPI, Cluster, Infrastructure
 */

import {
  generateNodeColor,
  generateColorFromTypeName,
  type NodeTypeColorScheme
} from './colorGenerator'

/**
 * 节点类型颜色映射
 */
export const NODE_TYPE_COLORS: Record<string, NodeTypeColorScheme> = {
  // ── 代码结构层 (Cyan) ───────────────────────────────
  Repository:   generateNodeColor('cyan', 0),
  Module:       generateNodeColor('cyan', 1),
  File:         generateNodeColor('cyan', 2),

  // ── 服务层 (Green) ──────────────────────────────────
  Service:      generateNodeColor('green', 0),
  API:          generateNodeColor('green', 1),
  APIEndpoint:  generateNodeColor('green', 2),
  Component:    generateNodeColor('green', 3),

  // ── 数据/类层 (Purple) ──────────────────────────────
  Class:        generateNodeColor('purple', 0),
  Database:     generateNodeColor('purple', 1),
  Table:        generateNodeColor('purple', 2),
  DataObject:   generateNodeColor('purple', 3),
  DataSource:   generateNodeColor('purple', 4),
  DataSink:     generateNodeColor('purple', 5),

  // ── AI 优先流水线 - 实体层 (Purple) ────────────────
  Entity:       generateNodeColor('purple', 6),  // JPA 实体类

  // ── AI 优先流水线 - 字段层 (Cyan 变体) ─────────────
  Field:        generateNodeColor(190, 3),  // 浅蓝色

  // ── 事件/流程层 (Amber) ─────────────────────────────
  Event:        generateNodeColor('amber', 0),
  Topic:        generateNodeColor('amber', 1),
  EventHandler: generateNodeColor('amber', 2),
  MessageQueue: generateNodeColor('amber', 3),
  Flow:         generateNodeColor('amber', 4),
  BusinessFlow: generateNodeColor('amber', 5),
  Pipeline:     generateNodeColor('amber', 6),

  // ── AI 优先流水线 - 流程节点层 (Green 变体) ────────
  FlowNode:     generateNodeColor(150, 4),  // 浅绿色

  // ── 架构层 (Blue) ───────────────────────────────────
  Layer:            generateNodeColor('blue', 0),
  Domain:           generateNodeColor('blue', 1),
  BoundedContext:   generateNodeColor('blue', 2),
  DomainEntity:     generateNodeColor('blue', 3),

  // ── 外部/基础设施 (Red) ─────────────────────────────
  ExternalAPI:      generateNodeColor('red', 0),
  Cluster:          generateNodeColor('red', 1),
  Infrastructure:   generateNodeColor('red', 2),

  // ── 功能层 (混合) ───────────────────────────────────
  Function:     generateNodeColor(200, 0),  // 青灰色
}

/**
 * 获取节点类型颜色
 * 未定义类型自动生成颜色
 *
 * @param type - 节点类型名称（大小写不敏感）
 */
export function getNodeTypeColor(type: string): NodeTypeColorScheme {
  // 标准化类型名称：大小写不敏感匹配
  const normalizedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()

  if (NODE_TYPE_COLORS[normalizedType]) {
    return NODE_TYPE_COLORS[normalizedType]
  }

  // 尝试原始类型名（向后兼容）
  if (NODE_TYPE_COLORS[type]) {
    return NODE_TYPE_COLORS[type]
  }

  // 为未知类型自动生成颜色（基于类型名哈希）
  return generateColorFromTypeName(type)
}
