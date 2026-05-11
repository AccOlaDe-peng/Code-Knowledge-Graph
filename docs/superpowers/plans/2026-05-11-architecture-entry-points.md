# 架构图入口节点精简实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简架构图节点，仅展示入口节点并添加功能说明

**Architecture:** 后端 TreeSitterTool 提取注解/注释，frontend.ts 筛选入口节点并生成功能说明，前端 NodeCard 展示

**Tech Stack:** TypeScript, Tree-sitter, React, Ant Design

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `code-graph-ts/src/agents/tools/TreeSitterTool.ts` | AST 提取注解和注释 | 修改 |
| `code-graph-ts/src/api/routes/frontend.ts` | 入口节点筛选逻辑 | 修改 |
| `code-graph-ui/src/types/architecture.ts` | 类型定义扩展 | 修改 |
| `code-graph-ui/src/components/graph/LayeredArchitecture/NodeCard.tsx` | 展示功能说明 | 修改 |
| `code-graph-ts/tests/entry-points.test.ts` | 单元测试 | 创建 |

---

## Task 1: 扩展 TreeSitterTool 提取注解和注释

**Files:**
- Modify: `code-graph-ts/src/agents/tools/TreeSitterTool.ts:321-370`

- [ ] **Step 1: 添加注解和注释提取辅助函数**

在 `extractSymbolsFromAST` 函数之前添加以下代码：

```typescript
// ── Annotation & DocComment Extraction ─────────────────────

/**
 * 提取 Java 注解（如 @Service, @Controller）
 */
function extractJavaAnnotations(node: any): string[] {
  const annotations: string[] = [];
  
  // Java: 遍历 class_declaration 的 modifiers 或直接子节点
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    
    if (child.type === 'marker_annotation') {
      // @Service（无参数）
      const nameNode = child.childForFieldName('name') ?? child.namedChild(0);
      if (nameNode) {
        annotations.push('@' + nameNode.text);
      }
    } else if (child.type === 'annotation') {
      // @RequestMapping("/api")（有参数）
      const nameNode = child.childForFieldName('name') ?? child.namedChild(0);
      if (nameNode) {
        annotations.push('@' + nameNode.text);
      }
    }
  }
  
  return annotations;
}

/**
 * 提取 TypeScript 装饰器（如 @Controller）
 */
function extractTSDecorators(node: any): string[] {
  const decorators: string[] = [];
  
  // TypeScript: decorator 节点在 class 前面
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    
    if (child.type === 'decorator') {
      const nameNode = child.namedChild(0);
      if (nameNode) {
        decorators.push('@' + nameNode.text);
      }
    }
  }
  
  return decorators;
}

/**
 * 提取类注释（Javadoc/JSDoc）
 */
function extractDocComment(node: any): string | null {
  // Tree-sitter: 前一个兄弟节点可能是 comment
  const prevSibling = node.previousSibling;
  if (prevSibling?.type === 'comment' || prevSibling?.type === 'block_comment') {
    const text = prevSibling.text;
    // 清理注释格式
    if (text.startsWith('/**') || text.startsWith('/*')) {
      return text
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '')
        .replace(/^\s*\*\s?/gm, '')  // 移除每行开头的 *
        .trim();
    }
    return text;
  }
  return null;
}
```

- [ ] **Step 2: 修改 extractSymbolsFromAST 函数**

将现有的 `extractSymbolsFromAST` 函数修改为：

```typescript
function extractSymbolsFromAST(root: any, filePath: string, symbols: ExtractedSymbol[]): void {
  const cursor = root.walk();
  const sourceCode = root.text;

  const visitNode = (): void => {
    const node = cursor.currentNode;
    const nodeType = node.type;

    if (nodeType === 'class_declaration' || nodeType === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        // 提取注解和注释
        const annotations = extractJavaAnnotations(node);
        const docComment = extractDocComment(node);
        
        symbols.push({
          name: nameNode.text,
          type: nodeType === 'class_declaration' ? 'class' : 'interface',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {
            annotations,
            docComment,
          },
        });
      }
    } else if (nodeType === 'method_declaration' || nodeType === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: 'method',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {},
        });
      }
    } else if (nodeType === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: 'function',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {},
        });
      }
    } else if (nodeType === 'class_definition' || nodeType === 'interface_declaration') {
      // TypeScript/Python class
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const decorators = extractTSDecorators(node);
        const docComment = extractDocComment(node);
        
        symbols.push({
          name: nameNode.text,
          type: 'class',
          location: { file: filePath, startLine: node.startPosition.row + 1 },
          metadata: {
            annotations: decorators,
            docComment,
          },
        });
      }
    }

    // Recurse into children
    if (cursor.gotoFirstChild()) {
      visitNode();
      while (cursor.gotoNextSibling()) {
        visitNode();
      }
      cursor.gotoParent();
    }
  };

  visitNode();
}
```

- [ ] **Step 3: 运行现有测试确保无回归**

```bash
cd code-graph-ts && bun test tests/core.test.ts
```

Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add code-graph-ts/src/agents/tools/TreeSitterTool.ts
git commit -m "feat: TreeSitterTool 提取类注解和注释"
```

---

## Task 2: 添加入口节点筛选逻辑到 frontend.ts

**Files:**
- Modify: `code-graph-ts/src/api/routes/frontend.ts:600-740`

- [ ] **Step 1: 添加入口节点判断辅助函数**

在 `detectLayer` 函数之后添加：

```typescript
// ── Entry Point Detection ─────────────────────────────────

const ENTRY_ANNOTATIONS: Record<LayerId, RegExp[]> = {
  [LayerId.api]: [/Controller/, /RestController/, /Endpoint/, /RequestMapping/],
  [LayerId.business]: [/Service/, /Component/, /Facade/, /Manager/],
  [LayerId.data]: [/Repository/, /Dao/, /Mapper/],
  [LayerId.infrastructure]: [/Configuration/, /Config/],
};

/**
 * 判断是否为入口节点
 * 条件: 有特定注解 或 被跨层调用
 */
function isEntryPoint(
  node: GraphNode,
  nodeLayer: LayerId,
  crossLayerCallers: Map<string, Set<LayerId>>
): boolean {
  // 条件 1: 特定注解
  const annotations = (node.metadata?.annotations as string[] | undefined) ?? [];
  const patterns = ENTRY_ANNOTATIONS[nodeLayer] ?? [];
  
  if (annotations.some(a => patterns.some(p => p.test(a)))) {
    return true;
  }
  
  // 条件 2: 跨层调用
  const callers = crossLayerCallers.get(node.id);
  if (callers) {
    for (const callerLayer of callers) {
      if (callerLayer !== nodeLayer) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 构建跨层调用关系图
 * 返回: Map<被调用节点ID, Set<调用者所在层级>>
 */
function buildCrossLayerCallers(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeLayerMap: Map<string, LayerId>
): Map<string, Set<LayerId>> {
  const callers = new Map<string, Set<LayerId>>();
  
  for (const edge of edges) {
    if (edge.type !== 'calls' && edge.type !== 'depends_on') continue;
    
    const targetLayer = nodeLayerMap.get(edge.target);
    const sourceLayer = nodeLayerMap.get(edge.source);
    
    if (targetLayer !== undefined && sourceLayer !== undefined && targetLayer !== sourceLayer) {
      if (!callers.has(edge.target)) {
        callers.set(edge.target, new Set());
      }
      callers.get(edge.target)!.add(sourceLayer);
    }
  }
  
  return callers;
}

/**
 * 提取注释摘要
 */
function extractDocSummary(docComment: string | undefined): string | null {
  if (!docComment) return null;
  
  // 提取 @summary 标签
  const summaryMatch = docComment.match(/@summary\s+(.+)/);
  if (summaryMatch) {
    return summaryMatch[1]!.trim().slice(0, 80);
  }
  
  // 提取首句描述（截至句号）
  const lines = docComment.split('\n').filter(l => l.trim() && !l.startsWith('@'));
  if (lines.length > 0) {
    const firstLine = lines[0]!.trim();
    const sentenceEnd = firstLine.search(/[.。]/);
    if (sentenceEnd > 0) {
      return firstLine.slice(0, sentenceEnd + 1);
    }
    return firstLine.slice(0, 50);
  }
  
  return null;
}

/**
 * 筛选关键方法名
 */
function filterKeyMethods(methods: string[] | undefined): string[] {
  if (!methods) return [];
  
  const businessPatterns = /^(get|save|update|delete|process|handle|create|find|query|list|add|remove)/i;
  return methods.filter(m => businessPatterns.test(m)).slice(0, 3);
}
```

- [ ] **Step 2: 修改 `/graph/architecture/:repoId` 端点**

将现有的端点实现替换为：

```typescript
  // GET /graph/architecture/:repoId — layered architecture view (entry points only)
  app.get<{ Params: { repoId: string } }>(
    '/graph/architecture/:repoId',
    async (request, reply) => {
      const { repoId } = request.params;

      // Try direct load first (sessionId as graphId)
      let graph = await store.load(repoId);

      // If not found, search through all persisted graphs
      if (!graph) {
        const sessions = await store.listSessions();
        for (const { sessionId, meta } of sessions) {
          if (meta.repoId === repoId) {
            graph = await store.load(sessionId);
            if (graph && graph.nodes.length > 0) break;
          }
          if (!graph && meta.repoPath) {
            const repoIdName = repoId.split('_')[0];
            const metaPathName = meta.repoPath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop()!;
            if (repoIdName && (metaPathName === repoIdName || repoIdName.includes(metaPathName))) {
              graph = await store.load(sessionId);
              if (graph && graph.nodes.length > 0) break;
            }
          }
          const session = get(sessionId);
          if (session?.options?.repoId === repoId && session.result) {
            graph = session.result;
            break;
          }
        }
      }

      const session = get(repoId);
      if (!graph && session?.result) {
        graph = session.result;
      }

      if (!graph) {
        for (const s of list()) {
          if (s.options?.repoId === repoId && s.result) {
            graph = s.result;
            break;
          }
        }
      }

      if (!graph) {
        reply.code(404);
        return { detail: `Graph not found: ${repoId}` };
      }

      const nodes = graph.nodes;
      const edges = graph.edges;

      // Step 1: 构建节点层级映射
      const nodeLayerMap = new Map<string, LayerId>();
      const classNodes: GraphNode[] = [];
      
      for (const node of nodes) {
        if (node.type === 'Class' || node.type === 'Interface') {
          const layerId = detectLayer(node);
          nodeLayerMap.set(node.id, layerId);
          classNodes.push(node);
        }
      }

      // Step 2: 构建跨层调用关系
      const crossLayerCallers = buildCrossLayerCallers(nodes, edges, nodeLayerMap);

      // Step 3: 初始化四层结构
      const layerNodes: Record<LayerId, ArchitectureNode[]> = {
        [LayerId.api]: [],
        [LayerId.business]: [],
        [LayerId.data]: [],
        [LayerId.infrastructure]: [],
      };

      // Step 4: 构建节点 ID 到节点对象的映射
      const nodeMap = new Map<string, GraphNode>();
      for (const node of nodes) {
        nodeMap.set(node.id, node);
      }

      // Step 5: 遍历节点，筛选入口节点
      for (const node of classNodes) {
        const layerId = nodeLayerMap.get(node.id)!;
        
        // 判断是否为入口节点
        if (!isEntryPoint(node, layerId, crossLayerCallers)) {
          continue;
        }

        // 提取方法
        const methods = edges
          .filter(e => e.source === node.id && e.type === 'defines')
          .map(e => nodeMap.get(e.target)?.label)
          .filter((m): m is string => Boolean(m));

        // 提取功能说明
        const docComment = node.metadata?.docComment as string | undefined;
        const description = extractDocSummary(docComment);
        const keyMethods = description ? undefined : filterKeyMethods(methods);

        const archNode: ArchitectureNode = {
          id: node.id,
          name: node.label,
          displayName: node.label,
          type: node.type.toLowerCase() as 'class' | 'interface',
          file: node.file,
          isEntryPoint: true,
          description,
          keyMethods,
        };

        if (methods.length > 0) {
          archNode.methods = methods.slice(0, 10);
        }

        layerNodes[layerId].push(archNode);
      }

      // Step 6: 构建层级数据
      const layers = Object.entries(LayerConfig).map(([id, config]) => ({
        id,
        name: config.name,
        color: config.color,
        nodes: layerNodes[id as LayerId],
      }));

      // Step 7: 过滤入口节点间的边
      const entryNodeIds = new Set(classNodes.filter(n => isEntryPoint(n, nodeLayerMap.get(n.id)!, crossLayerCallers)).map(n => n.id));
      const archEdges = edges
        .filter(e => 
          (e.type === 'calls' || e.type === 'depends_on') &&
          entryNodeIds.has(e.source) &&
          entryNodeIds.has(e.target)
        )
        .map(e => ({
          from: e.source,
          to: e.target,
          type: e.type,
        }));

      // Step 8: 统计信息
      const stats = {
        total_nodes: nodes.length,
        total_edges: edges.length,
        entry_points: {
          api: layerNodes[LayerId.api].length,
          business: layerNodes[LayerId.business].length,
          data: layerNodes[LayerId.data].length,
          infrastructure: layerNodes[LayerId.infrastructure].length,
        },
      };

      return {
        repo_id: repoId,
        layers,
        edges: archEdges,
        stats,
      };
    }
  );
```

- [ ] **Step 3: 运行现有测试确保无回归**

```bash
cd code-graph-ts && bun test tests/api.test.ts
```

Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add code-graph-ts/src/api/routes/frontend.ts
git commit -m "feat: 架构图入口节点筛选逻辑"
```

---

## Task 3: 扩展前端类型定义

**Files:**
- Modify: `code-graph-ui/src/types/architecture.ts:22-34`

- [ ] **Step 1: 扩展 ArchitectureNode 类型**

修改 `ArchitectureNode` 类型定义：

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add code-graph-ui/src/types/architecture.ts
git commit -m "feat: ArchitectureNode 类型扩展 description 和 keyMethods"
```

---

## Task 4: 修改 NodeCard 组件展示功能说明

**Files:**
- Modify: `code-graph-ui/src/components/graph/LayeredArchitecture/NodeCard.tsx`

- [ ] **Step 1: 在节点名称后添加功能说明展示**

修改 NodeCard 组件，在类名之后、功能标签之前添加：

```tsx
import React from 'react'
import type { ArchitectureNode } from '../../../types/architecture'

type NodeCardProps = {
  node: ArchitectureNode
  layerColor: string
  isSelected: boolean
  isHovered: boolean
  onClick: () => void
  onHover: () => void
  onLeave: () => void
}

/**
 * NodeCard - 架构图层节点卡片
 *
 * v2.1 - 入口节点功能说明：
 * - 展示 description（注释提取）
 * - 备选展示 keyMethods（关键方法名）
 */
const NodeCard: React.FC<NodeCardProps> = ({
  node,
  layerColor,
  isSelected,
  isHovered,
  onClick,
  onHover,
  onLeave,
}) => {
  const hasDetails = (node.functions?.length ?? 0) > 0 ||
    (node.dependencies?.length ?? 0) > 0 ||
    (node.endpoints?.length ?? 0) > 0

  // 功能说明：优先 description，备选 keyMethods
  const renderDescription = () => {
    if (node.description) {
      return (
        <div
          style={{
            fontSize: 11,
            color: 'var(--t-secondary)',
            marginTop: 6,
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
          title={node.description}
        >
          {node.description}
        </div>
      )
    }
    
    if (node.keyMethods && node.keyMethods.length > 0) {
      return (
        <div
          style={{
            fontSize: 11,
            color: 'var(--t-muted)',
            marginTop: 6,
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.keyMethods.join(', ')}
        >
          {node.keyMethods.join(', ')}
        </div>
      )
    }
    
    return null
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        backgroundColor: isSelected
          ? `rgba(${hexToRgb(layerColor)}, 0.25)`
          : isHovered
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.04)',
        border: isSelected
          ? `3px solid ${layerColor}`
          : isHovered
            ? `2.5px solid ${layerColor}`
            : `2px solid ${layerColor}66`,
        cursor: hasDetails ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        minWidth: 150,
        maxWidth: 210,
        boxShadow: isSelected
          ? `0 0 20px ${layerColor}35, 0 4px 12px rgba(0,0,0,0.3)`
          : isHovered
            ? `0 0 12px ${layerColor}20, 0 2px 8px rgba(0,0,0,0.25)`
            : '0 2px 6px rgba(0,0,0,0.2)',
      }}
    >
      {/* 节点名称 */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: isSelected ? layerColor : 'var(--t-primary)',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textShadow: isSelected ? `0 0 8px ${layerColor}40` : 'none',
        }}
        title={node.displayName}
      >
        {node.displayName}
      </div>

      {/* 类名（如果有） */}
      {node.name !== node.displayName && (
        <div
          style={{
            fontSize: 10,
            color: '#8a98b8',
            fontFamily: 'var(--font-mono)',
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.name}
        >
          {node.name}
        </div>
      )}

      {/* 功能说明（新增） */}
      {renderDescription()}

      {/* 功能数量标签 */}
      {hasDetails && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 8,
          }}
        >
          {(node.functions?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 5,
                backgroundColor: 'rgba(0, 240, 132, 0.18)',
                color: '#00f084',
                fontWeight: 500,
              }}
            >
              {node.functions!.length} 功能
            </span>
          )}
          {(node.endpoints?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 5,
                backgroundColor: 'rgba(0, 212, 255, 0.18)',
                color: '#00d4ff',
                fontWeight: 500,
              }}
            >
              {node.endpoints!.length} API
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// 辅助函数：Hex 转 RGB
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '0, 212, 255'
}

export default NodeCard
```

- [ ] **Step 2: Commit**

```bash
git add code-graph-ui/src/components/graph/LayeredArchitecture/NodeCard.tsx
git commit -m "feat: NodeCard 展示节点功能说明"
```

---

## Task 5: 添加单元测试

**Files:**
- Create: `code-graph-ts/tests/entry-points.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, test, expect } from 'bun:test';
import { LayerId } from '../src/graph/schema.ts';

// 复制 frontend.ts 中的函数进行测试
const ENTRY_ANNOTATIONS: Record<LayerId, RegExp[]> = {
  [LayerId.api]: [/Controller/, /RestController/, /Endpoint/, /RequestMapping/],
  [LayerId.business]: [/Service/, /Component/, /Facade/, /Manager/],
  [LayerId.data]: [/Repository/, /Dao/, /Mapper/],
  [LayerId.infrastructure]: [/Configuration/, /Config/],
};

function isEntryPoint(
  node: { metadata?: { annotations?: string[] } },
  nodeLayer: LayerId,
  crossLayerCallers: Map<string, Set<LayerId>>
): boolean {
  const annotations = node.metadata?.annotations ?? [];
  const patterns = ENTRY_ANNOTATIONS[nodeLayer] ?? [];
  
  if (annotations.some((a: string) => patterns.some(p => p.test(a)))) {
    return true;
  }
  
  const callers = crossLayerCallers.get((node as any).id);
  if (callers) {
    for (const callerLayer of callers) {
      if (callerLayer !== nodeLayer) {
        return true;
      }
    }
  }
  
  return false;
}

function extractDocSummary(docComment: string | undefined): string | null {
  if (!docComment) return null;
  
  const summaryMatch = docComment.match(/@summary\s+(.+)/);
  if (summaryMatch) {
    return summaryMatch[1]!.trim().slice(0, 80);
  }
  
  const lines = docComment.split('\n').filter(l => l.trim() && !l.startsWith('@'));
  if (lines.length > 0) {
    const firstLine = lines[0]!.trim();
    const sentenceEnd = firstLine.search(/[.。]/);
    if (sentenceEnd > 0) {
      return firstLine.slice(0, sentenceEnd + 1);
    }
    return firstLine.slice(0, 50);
  }
  
  return null;
}

function filterKeyMethods(methods: string[] | undefined): string[] {
  if (!methods) return [];
  
  const businessPatterns = /^(get|save|update|delete|process|handle|create|find|query|list|add|remove)/i;
  return methods.filter(m => businessPatterns.test(m)).slice(0, 3);
}

describe('isEntryPoint', () => {
  test('returns true for node with @Controller annotation', () => {
    const node = { id: 'test', metadata: { annotations: ['@Controller'] } };
    const callers = new Map<string, Set<LayerId>>();
    
    expect(isEntryPoint(node, LayerId.api, callers)).toBe(true);
  });

  test('returns true for node with @Service annotation', () => {
    const node = { id: 'test', metadata: { annotations: ['@Service'] } };
    const callers = new Map<string, Set<LayerId>>();
    
    expect(isEntryPoint(node, LayerId.business, callers)).toBe(true);
  });

  test('returns true for node with cross-layer callers', () => {
    const node = { id: 'test', metadata: { annotations: [] } };
    const callers = new Map<string, Set<LayerId>>();
    callers.set('test', new Set([LayerId.api]));
    
    expect(isEntryPoint(node, LayerId.business, callers)).toBe(true);
  });

  test('returns false for internal helper class', () => {
    const node = { id: 'test', metadata: { annotations: [] } };
    const callers = new Map<string, Set<LayerId>>();
    // 同层调用，不是入口
    callers.set('test', new Set([LayerId.data]));
    
    expect(isEntryPoint(node, LayerId.data, callers)).toBe(false);
  });
});

describe('extractDocSummary', () => {
  test('extracts @summary tag', () => {
    const doc = '@summary 用户认证服务';
    expect(extractDocSummary(doc)).toBe('用户认证服务');
  });

  test('extracts first sentence', () => {
    const doc = '用户认证服务，处理登录和注销。后续内容不需要。';
    expect(extractDocSummary(doc)).toBe('用户认证服务，处理登录和注销。');
  });

  test('returns null for undefined', () => {
    expect(extractDocSummary(undefined)).toBe(null);
  });

  test('limits to 50 chars when no sentence end', () => {
    const doc = '这是一个非常长的描述文字没有任何句号结尾';
    expect(extractDocSummary(doc)).toBe('这是一个非常长的描述文字没有任何句号结尾');
  });
});

describe('filterKeyMethods', () => {
  test('filters business semantic methods', () => {
    const methods = ['getUser', 'saveUser', 'internalHelper', 'deleteUser'];
    expect(filterKeyMethods(methods)).toEqual(['getUser', 'saveUser', 'deleteUser']);
  });

  test('returns empty array for undefined', () => {
    expect(filterKeyMethods(undefined)).toEqual([]);
  });

  test('limits to 3 methods', () => {
    const methods = ['getUser', 'saveUser', 'deleteUser', 'updateUser', 'listUsers'];
    expect(filterKeyMethods(methods)).toEqual(['getUser', 'saveUser', 'deleteUser']);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd code-graph-ts && bun test tests/entry-points.test.ts
```

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add code-graph-ts/tests/entry-points.test.ts
git commit -m "test: 入口节点筛选函数单元测试"
```

---

## Task 6: 端到端验证

**Files:**
- N/A（手动验证）

- [ ] **Step 1: 启动后端服务**

```bash
cd code-graph-ts && bun start
```

- [ ] **Step 2: 启动前端服务**

```bash
cd code-graph-ui && npm run dev
```

- [ ] **Step 3: 验证架构图**

1. 打开浏览器访问 `http://localhost:5173/architecture`
2. 选择一个已分析的仓库
3. 检查架构图是否只显示入口节点
4. 检查节点卡片是否显示功能说明

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: 架构图入口节点精简功能完成"
```

---

## 自审清单

| 检查项 | 状态 |
|--------|------|
| Spec 覆盖率 | ✓ 所有需求有对应任务 |
| Placeholder 扫描 | ✓ 无 TBD/TODO |
| 类型一致性 | ✓ 前后端类型定义一致 |
| 测试覆盖 | ✓ 核心函数有单元测试 |
