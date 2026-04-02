# 数据血缘图视觉与交互优化实现计划

## 背景

参见设计文档：`docs/superpowers/specs/2026-04-02-data-lineage-visual-optimization-design.md`

## 实施步骤

### Phase 1: 视觉提亮 - 模块节点

**目标**：提升模块节点内文字的可读性

**改动文件**：`src/pages/DataLineage/components/ModuleGraph/ModuleNode.tsx`

**具体修改**：

1. **描述文字颜色**（第 105 行）
   ```typescript
   // 当前
   color: "#9aa8c8"
   // 改为
   color: "#c8d4e8"
   ```

2. **统计标签文字颜色**（第 134、144、154 行）
   ```typescript
   // 当前
   color: "#6a7a9a"
   // 改为
   color: "#8898b8"
   ```

**验证**：启动开发服务器，查看模块节点的描述和统计标签是否更清晰

---

### Phase 2: 视觉提亮 - 详情面板

**目标**：提升详情面板内文字的可读性

**改动文件**：`src/pages/DataLineage/components/ModuleDetailPanel/index.tsx`

**具体修改**：

1. **模块全名颜色**（第 243 行附近）
   ```typescript
   // 当前
   color: "#5a6a8a"
   // 改为
   color: "#7888a8"
   ```

2. **模块描述颜色**（第 253 行附近）
   ```typescript
   // 当前
   color: "#6a7a9a"
   // 改为
   color: "#98a8c8"
   ```

3. **统计徽章标签颜色**（第 393 行附近）
   ```typescript
   // 当前
   color: "#6a7a9a"
   // 改为
   color: "#8898b8"
   ```

**验证**：点击模块查看详情面板，确认文字更清晰

---

### Phase 3: 悬浮高亮交互 - 状态管理

**目标**：实现悬浮模块时高亮关联元素

**改动文件**：`src/pages/DataLineage/components/ModuleGraph/index.tsx`

**具体修改**：

1. **新增悬浮状态**
   ```typescript
   // 在组件顶部添加
   const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);
   ```

2. **计算关联节点集合**
   ```typescript
   // 在 useMemo 区域添加
   const relatedNodes = useMemo(() => {
     if (!hoveredModuleId) return null;
     const related = new Set<string>([hoveredModuleId]);
     dependencies.forEach(dep => {
       if (dep.from === hoveredModuleId) related.add(dep.to);
       if (dep.to === hoveredModuleId) related.add(dep.from);
     });
     return related;
   }, [hoveredModuleId, dependencies]);
   ```

3. **ReactFlow 事件绑定**
   ```typescript
   // 在 ReactFlow 组件上添加
   <ReactFlow
     onNodeMouseEnter={(_, node) => setHoveredModuleId(node.id)}
     onNodeMouseLeave={() => setHoveredModuleId(null)}
     // ... 其他 props
   >
   ```

---

### Phase 4: 悬浮高亮交互 - 样式应用

**目标**：将悬浮状态应用到节点和边的样式

**改动文件**：`src/pages/DataLineage/components/ModuleGraph/index.tsx`

**具体修改**：

1. **节点样式增加 opacity**
   ```typescript
   // 在创建 flowNodes 时添加 style
   const flowNodes: Node[] = modules.map((module) => ({
     // ... 其他属性
     style: {
       opacity: hoveredModuleId && !relatedNodes?.has(module.id) ? 0.15 : 1,
       transition: 'opacity 0.2s ease',
     },
   }));
   ```

2. **边样式增加 opacity**
   ```typescript
   // 在创建 flowEdges 时添加 opacity 逻辑
   const isRelatedEdge = (dep: ModuleDependency) => {
     if (!hoveredModuleId) return true;
     return dep.from === hoveredModuleId || dep.to === hoveredModuleId;
   };

   const flowEdges: Edge[] = dependencies.map((dep) => ({
     // ... 其他属性
     style: {
       // ... 其他样式
       opacity: hoveredModuleId && !isRelatedEdge(dep) ? 0.15 : 0.95,
       transition: 'opacity 0.2s ease',
     },
   }));
   ```

**验证**：悬浮模块，确认关联元素高亮、无关元素变暗

---

### Phase 5: 布局优化

**目标**：改善节点分布和边的走向

**改动文件**：`src/pages/DataLineage/components/ModuleGraph/index.tsx`

**具体修改**：

1. **调整 dagre 布局参数**
   ```typescript
   // applyDagreLayout 函数中
   g.setGraph({
     rankdir: direction,
     nodesep: 120,    // 从 90 增加
     ranksep: 180,    // 从 140 增加
     marginx: 60,     // 从 50 增加
     marginy: 60,     // 从 50 增加
     align: 'UL',     // 新增：上左对齐
   });
   ```

2. **调整节点尺寸参数**（如需要）
   ```typescript
   // 根据实际效果调整
   g.setNode(n.id, { width: 220, height: 90 }); // 从 80 增加到 90
   ```

3. **fitView padding 调整**
   ```typescript
   // ReactFlow 组件上
   fitView
   fitViewOptions={{ padding: 0.25 }}
   ```

**验证**：重新加载页面，确认节点间距更均匀

---

### Phase 6: 边标签优化

**目标**：让边上的类型标签更醒目

**改动文件**：`src/pages/DataLineage/components/ModuleGraph/index.tsx`

**具体修改**：

```typescript
// 边标签样式优化
labelBgStyle: {
  fill: "#0a0f18",
  fillOpacity: 0.98,      // 从 0.95 增加
  stroke: style.color,
  strokeWidth: 1,         // 从 0.5 增加
  strokeOpacity: 0.8,     // 从 0.5 增加
},
```

**验证**：查看边标签是否更清晰

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/pages/DataLineage/components/ModuleGraph/ModuleNode.tsx` | 修改 | 提亮文字颜色 |
| `src/pages/DataLineage/components/ModuleGraph/index.tsx` | 修改 | 悬浮高亮 + 布局优化 + 边标签优化 |
| `src/pages/DataLineage/components/ModuleDetailPanel/index.tsx` | 修改 | 提亮面板文字颜色 |

---

## 验收标准

1. **视觉**：
   - 模块节点描述文字对比度 ≥ 4.5:1
   - 统计标签文字对比度 ≥ 4.5:1
   - 详情面板文字对比度 ≥ 4.5:1

2. **交互**：
   - 悬浮模块时，关联模块和边正常显示
   - 无关模块和边变暗（opacity: 0.15）
   - 过渡动画平滑（0.2s ease）

3. **布局**：
   - 节点间距均匀，无明显重叠
   - 边的路径清晰，交叉较少
   - 整体视觉舒适

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 颜色提亮可能影响视觉层次 | 保持颜色相对关系，仅统一提亮 |
| 悬浮交互可能与点击冲突 | 使用独立状态，不影响选中逻辑 |
| 布局参数调整可能影响大图 | 测试不同规模图谱效果 |

---

## 执行顺序

1. Phase 1: 视觉提亮 - 模块节点（低风险，立即见效）
2. Phase 2: 视觉提亮 - 详情面板（低风险，立即见效）
3. Phase 3-4: 悬浮高亮交互（核心功能）
4. Phase 5: 布局优化（可调整参数）
5. Phase 6: 边标签优化（收尾）
