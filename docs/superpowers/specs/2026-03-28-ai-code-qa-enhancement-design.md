# AI 代码问答功能增强设计文档

## 概述

修复 AI 代码问答模块的基础问题，并添加对话历史和代码引用跳转功能。

## 背景

当前 AI 代码问答模块存在以下问题：
1. LLM 客户端配置读取不一致，导致无法正确调用模型
2. 缺少对话历史功能，每次查询独立
3. 缺少代码引用跳转功能

## 目标

1. 修复 LLM 配置读取问题，确保基础功能可用
2. 添加前端对话历史功能（localStorage 存储）
3. 添加源代码路径复制功能

## 设计细节

### 1. 修复 LLM 配置读取

**问题**：`backend/ai/llm_client.py` 的 `get_default_client()` 只读取 `ANTHROPIC_BASE_URL`，但 .env 配置的是 `LLM_BASE_URL`

**修改**：
- 文件：`backend/ai/llm_client.py`
- 行号：315
- 修改读取顺序：`LLM_BASE_URL → ANTHROPIC_BASE_URL → OPENAI_BASE_URL`

```python
# 修改前
base_url = os.getenv("ANTHROPIC_BASE_URL") or os.getenv("OPENAI_BASE_URL")

# 修改后
base_url = os.getenv("LLM_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL") or os.getenv("OPENAI_BASE_URL")
```

### 2. 前端对话历史功能

**数据结构**：

```typescript
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  nodes?: GraphNode[]  // AI 回复关联的节点
  edges?: GraphEdge[]
  sources?: string[]
  confidence?: number
}

interface ChatSession {
  id: string
  graphId: string
  title: string        // 首条消息摘要
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}
```

**存储**：localStorage，key 格式 `ckg-chat-{graphId}`

**新增文件**：`src/hooks/useChatHistory.ts`

**功能**：
- 创建新会话
- 加载历史会话
- 添加消息
- 删除会话
- 清空所有历史

**UI 修改**：
- 添加左侧历史会话列表（可折叠）
- 当前会话消息列表显示
- 新建/删除会话按钮

### 3. 源代码路径复制

**功能**：
- 点击源文件路径时复制完整路径到剪贴板
- 显示 Toast 提示

**实现**：
- 修改 `GraphQuery/index.tsx` 中的源文件列表
- 添加点击事件处理

## 实现步骤

1. 修复 LLM 配置读取（1 处修改）
2. 创建 useChatHistory hook
3. 重构 GraphQuery 页面，集成对话历史
4. 添加源代码路径复制功能

## 风险

- localStorage 容量限制（约 5MB），建议限制每个仓库最多保存 10 个会话
- 浏览器隐私模式可能限制 localStorage

## 验收标准

1. LLM 客户端能正确读取 `LLM_BASE_URL` 配置
2. 用户可以进行多轮对话，历史记录持久化
3. 点击源文件路径可复制到剪贴板
