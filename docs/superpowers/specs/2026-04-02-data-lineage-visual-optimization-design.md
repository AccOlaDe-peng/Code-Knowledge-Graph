# 数据血缘图视觉与交互优化设计

## 背景

数据血缘图页面（`/lineage`）存在以下问题：
1. 视觉问题：部分文字、图形颜色太暗，在黑色背景中无法看清
2. 交互问题：缺乏悬浮高亮功能，无法快速识别模块间的关联关系
3. 布局问题：节点分布混乱、边线条杂乱，难以追踪数据走向

## 目标

- 提升文字可读性（对比度达到 WCAG AA 标准 4.5:1）
- 实现悬浮高亮交互，快速识别关联模块
- 优化布局，使数据流向更清晰

## 设计方案

### 一、视觉提亮

针对暗色背景（`#07090d`），调整以下元素的颜色：

| 元素 | 当前颜色 | 新颜色 | 对比度 |
|------|---------|--------|--------|
| 模块描述文字 | `#9aa8c8` | `#c8d4e8` | ~7:1 |
| 统计标签文字 | `#6a7a9a` | `#8898b8` | ~5:1 |
| 详情面板标题 | `#6a7a9a` | `#98a8c8` | ~5.5:1 |
| 详情面板描述 | `#6a7a9a` | `#8898b8` | ~5:1 |

边标签优化：
- 保持当前颜色（根据边类型动态设置）
- 增加标签背景不透明度至 0.98
- 增加标签边框可见性

### 二、悬浮高亮交互

**交互流程**：
1. 鼠标进入模块节点 → 触发高亮
2. 记录悬浮的 `nodeId`
3. 找出所有直接关联节点和边
4. 应用样式：
   - 相关元素：opacity: 1（正常显示）
   - 无关元素：opacity: 0.15（变暗）
5. 鼠标离开 → 恢复所有元素

**关联规则**：
- 目标模块本身
- 与目标模块有直接依赖关系的模块（无论 from/to）
- 连接这些模块的边

**样式过渡**：
- 使用 CSS transition 实现平滑过渡
- 过渡时间：0.2s ease

### 三、布局优化

**dagre 布局参数调整**：

```typescript
// 当前参数
{
  nodesep: 90,
  ranksep: 140,
  marginx: 50,
  marginy: 50,
}

// 优化后参数
{
  nodesep: 120,      // 节点水平间距 +30
  ranksep: 180,      // 层级垂直间距 +40
  marginx: 60,       // 左右边距 +10
  marginy: 60,       // 上下边距 +10
  align: 'UL',       // 上左对齐，减少布局抖动
}
```

**fitView 优化**：
- padding 从默认值调整为 0.25，给图留出更多呼吸空间

## 文件修改清单

| 文件路径 | 修改内容 |
|---------|---------|
| `src/pages/DataLineage/components/ModuleGraph/ModuleNode.tsx` | 提亮文字颜色 |
| `src/pages/DataLineage/components/ModuleGraph/index.tsx` | 悬浮高亮状态管理、布局参数、边样式优化 |
| `src/pages/DataLineage/components/ModuleDetailPanel/index.tsx` | 提亮面板文字颜色 |

## 技术实现要点

### ReactFlow 悬浮事件

```typescript
// ReactFlow 提供的节点悬浮事件
<ReactFlow
  onNodeMouseEnter={(event, node) => setHoveredModuleId(node.id)}
  onNodeMouseLeave={() => setHoveredModuleId(null)}
/>
```

### 节点/边样式动态计算

```typescript
// 计算关联节点集合
const relatedNodes = useMemo(() => {
  if (!hoveredModuleId) return null;
  const related = new Set<string>([hoveredModuleId]);
  dependencies.forEach(dep => {
    if (dep.from === hoveredModuleId) related.add(dep.to);
    if (dep.to === hoveredModuleId) related.add(dep.from);
  });
  return related;
}, [hoveredModuleId, dependencies]);

// 判断边是否关联
const isRelatedEdge = (dep: ModuleDependency) => {
  if (!hoveredModuleId) return true;
  return dep.from === hoveredModuleId || dep.to === hoveredModuleId;
};
```

## 验收标准

1. **视觉**：所有文字在黑色背景上清晰可读，对比度 ≥ 4.5:1
2. **交互**：悬浮模块时，关联元素高亮，无关元素变暗，过渡平滑
3. **布局**：节点间距均匀，边不重叠或交叉过多，整体视觉效果舒适

## 风险评估

- **低风险**：颜色调整为纯视觉变更，不影响功能
- **低风险**：悬浮交互为增量功能，不影响现有点击选择行为
- **低风险**：布局参数调整可独立回滚
