# AI 代码问答功能增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 代码问答模块的基础问题，添加对话历史和代码引用跳转功能。

**Architecture:**
1. 修复后端 LLM 客户端配置读取顺序，确保 `LLM_BASE_URL` 优先
2. 前端新增 `useChatHistory` hook 管理对话历史（localStorage 存储）
3. 重构 GraphQuery 页面集成对话历史 UI
4. 添加源代码路径复制功能

**Tech Stack:** Python (FastAPI), React, TypeScript, Zustand, localStorage

**Spec:** `docs/superpowers/specs/2026-03-28-ai-code-qa-enhancement-design.md`

---

## File Structure

```
code-graph-system/
└── backend/
    └── ai/
        └── llm_client.py          # Modify: get_default_client() base_url 读取

code-graph-ui/
└── src/
    ├── core/
    │   └── hooks/
    │       ├── index.ts           # Modify: 导出 useChatHistory
    │       └── useChatHistory.ts  # Create: 对话历史 hook
    ├── pages/
    │   └── GraphQuery/
    │       └── index.tsx          # Modify: 集成对话历史 + 路径复制
    └── types/
        └── chat.ts                # Create: 对话历史类型定义
```

---

## Task 1: 修复 LLM 配置读取

**Files:**
- Modify: `code-graph-system/backend/ai/llm_client.py:315`

- [ ] **Step 1: 修改 get_default_client() 的 base_url 读取顺序**

```python
# 修改前（第 314-315 行）
model = os.getenv("LLM_MODEL")
base_url = os.getenv("ANTHROPIC_BASE_URL") or os.getenv("OPENAI_BASE_URL")

# 修改后
model = os.getenv("LLM_MODEL")
base_url = os.getenv("LLM_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL") or os.getenv("OPENAI_BASE_URL")
```

- [ ] **Step 2: 验证修改**

```bash
cd code-graph-system
python -c "
from dotenv import load_dotenv
load_dotenv()
from backend.ai.llm_client import get_default_client
client = get_default_client()
print(f'Base URL: {client.base_url}')
print(f'Available: {client.is_available()}')
"
```

Expected: `Available: True`

- [ ] **Step 3: Commit**

```bash
git add backend/ai/llm_client.py
git commit -m "fix: 修复 LLM 客户端 LLM_BASE_URL 配置读取优先级"
```

---

## Task 2: 创建对话历史类型定义

**Files:**
- Create: `code-graph-ui/src/types/chat.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// code-graph-ui/src/types/chat.ts

import type { GraphNode, GraphEdge } from './graph'

// ─── Chat History Types ───────────────────────────────────────────────────────

export type ChatMessageRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  timestamp: number
  // AI 回复关联的上下文
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  sources?: string[]
  confidence?: number
}

export interface ChatSession {
  id: string
  graphId: string
  title: string           // 首条消息摘要（用于列表显示）
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ─── Storage Constants ────────────────────────────────────────────────────────

export const CHAT_STORAGE_KEY_PREFIX = 'ckg-chat-'
export const MAX_SESSIONS_PER_GRAPH = 10
export const MAX_MESSAGES_PER_SESSION = 50

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function truncateTitle(content: string, maxLength = 30): string {
  const cleaned = content.trim().replace(/\n/g, ' ')
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + '...' : cleaned
}
```

- [ ] **Step 2: Commit**

```bash
git add code-graph-ui/src/types/chat.ts
git commit -m "feat: 添加对话历史类型定义"
```

---

## Task 3: 创建 useChatHistory Hook

**Files:**
- Create: `code-graph-ui/src/core/hooks/useChatHistory.ts`
- Modify: `code-graph-ui/src/core/hooks/index.ts`

- [ ] **Step 1: 创建 useChatHistory hook**

```typescript
// code-graph-ui/src/core/hooks/useChatHistory.ts

import { useState, useCallback, useEffect } from 'react'
import type { ChatSession, ChatMessage } from '../../types/chat'
import {
  CHAT_STORAGE_KEY_PREFIX,
  MAX_SESSIONS_PER_GRAPH,
  MAX_MESSAGES_PER_SESSION,
  generateId,
  truncateTitle,
} from '../../types/chat'

// ─── Storage Helpers ──────────────────────────────────────────────────────────

function getStorageKey(graphId: string): string {
  return `${CHAT_STORAGE_KEY_PREFIX}${graphId}`
}

function loadSessions(graphId: string): ChatSession[] {
  try {
    const key = getStorageKey(graphId)
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveSessions(graphId: string, sessions: ChatSession[]): void {
  try {
    const key = getStorageKey(graphId)
    localStorage.setItem(key, JSON.stringify(sessions))
  } catch (e) {
    console.error('Failed to save chat sessions:', e)
  }
}

// ─── Hook Return Type ─────────────────────────────────────────────────────────

export type UseChatHistoryReturn = {
  sessions: ChatSession[]
  currentSession: ChatSession | null
  isLoading: boolean

  // Session management
  createSession: () => ChatSession
  selectSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  clearAllSessions: () => void

  // Message management
  addUserMessage: (content: string) => void
  addAssistantMessage: (
    content: string,
    context?: { nodes?: ChatMessage['nodes']; edges?: ChatMessage['edges']; sources?: string[]; confidence?: number }
  ) => void

  // Utility
  getCurrentSessionMessages: () => ChatMessage[]
}

// ─── Hook Implementation ──────────────────────────────────────────────────────

export function useChatHistory(graphId: string | null): UseChatHistoryReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load sessions when graphId changes
  useEffect(() => {
    if (!graphId) {
      setSessions([])
      setCurrentSessionId(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const loaded = loadSessions(graphId)
    setSessions(loaded)

    // Auto-select most recent session or create new one
    if (loaded.length > 0) {
      const sorted = [...loaded].sort((a, b) => b.updatedAt - a.updatedAt)
      setCurrentSessionId(sorted[0].id)
    } else {
      setCurrentSessionId(null)
    }

    setIsLoading(false)
  }, [graphId])

  // Get current session
  const currentSession = currentSessionId
    ? sessions.find(s => s.id === currentSessionId) ?? null
    : null

  // Persist sessions
  const persistSessions = useCallback(
    (newSessions: ChatSession[]) => {
      if (!graphId) return
      setSessions(newSessions)
      saveSessions(graphId, newSessions)
    },
    [graphId]
  )

  // Create new session
  const createSession = useCallback((): ChatSession => {
    if (!graphId) throw new Error('No graphId')

    const now = Date.now()
    const newSession: ChatSession = {
      id: generateId(),
      graphId,
      title: '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }

    // Limit sessions count
    let newSessions = [...sessions, newSession]
    if (newSessions.length > MAX_SESSIONS_PER_GRAPH) {
      // Remove oldest sessions
      newSessions = newSessions
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS_PER_GRAPH)
    }

    persistSessions(newSessions)
    setCurrentSessionId(newSession.id)
    return newSession
  }, [graphId, sessions, persistSessions])

  // Select session
  const selectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId)
  }, [])

  // Delete session
  const deleteSession = useCallback(
    (sessionId: string) => {
      const newSessions = sessions.filter(s => s.id !== sessionId)
      persistSessions(newSessions)

      if (currentSessionId === sessionId) {
        // Select another session or clear
        if (newSessions.length > 0) {
          const sorted = [...newSessions].sort((a, b) => b.updatedAt - a.updatedAt)
          setCurrentSessionId(sorted[0].id)
        } else {
          setCurrentSessionId(null)
        }
      }
    },
    [sessions, currentSessionId, persistSessions]
  )

  // Clear all sessions
  const clearAllSessions = useCallback(() => {
    persistSessions([])
    setCurrentSessionId(null)
  }, [persistSessions])

  // Add user message
  const addUserMessage = useCallback(
    (content: string) => {
      if (!currentSessionId) {
        // Auto-create session if none selected
        const session = createSession()
        // Continue with the new session
        const message: ChatMessage = {
          id: generateId(),
          role: 'user',
          content,
          timestamp: Date.now(),
        }

        const updatedSessions = sessions.map(s =>
          s.id === session.id
            ? {
                ...s,
                title: truncateTitle(content),
                messages: [message],
                updatedAt: Date.now(),
              }
            : s
        )
        // Add the new session with message
        const newSession: ChatSession = {
          ...session,
          title: truncateTitle(content),
          messages: [message],
          updatedAt: Date.now(),
        }
        persistSessions([...sessions.filter(s => s.id !== session.id), newSession])
        return
      }

      const message: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      }

      const updatedSessions = sessions.map(s => {
        if (s.id !== currentSessionId) return s

        const messages = [...s.messages, message].slice(-MAX_MESSAGES_PER_SESSION)
        const isFirstMessage = s.messages.length === 0

        return {
          ...s,
          title: isFirstMessage ? truncateTitle(content) : s.title,
          messages,
          updatedAt: Date.now(),
        }
      })

      persistSessions(updatedSessions)
    },
    [currentSessionId, sessions, createSession, persistSessions]
  )

  // Add assistant message
  const addAssistantMessage = useCallback(
    (
      content: string,
      context?: {
        nodes?: ChatMessage['nodes']
        edges?: ChatMessage['edges']
        sources?: string[]
        confidence?: number
      }
    ) => {
      if (!currentSessionId) return

      const message: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        nodes: context?.nodes,
        edges: context?.edges,
        sources: context?.sources,
        confidence: context?.confidence,
      }

      const updatedSessions = sessions.map(s => {
        if (s.id !== currentSessionId) return s
        const messages = [...s.messages, message].slice(-MAX_MESSAGES_PER_SESSION)
        return { ...s, messages, updatedAt: Date.now() }
      })

      persistSessions(updatedSessions)
    },
    [currentSessionId, sessions, persistSessions]
  )

  // Get current session messages
  const getCurrentSessionMessages = useCallback(() => {
    return currentSession?.messages ?? []
  }, [currentSession])

  return {
    sessions,
    currentSession,
    isLoading,
    createSession,
    selectSession,
    deleteSession,
    clearAllSessions,
    addUserMessage,
    addAssistantMessage,
    getCurrentSessionMessages,
  }
}

export default useChatHistory
```

- [ ] **Step 2: 更新 hooks index.ts 导出**

```typescript
// 在文件末尾添加
export { useChatHistory } from './useChatHistory'
export type { UseChatHistoryReturn } from './useChatHistory'
```

- [ ] **Step 3: Commit**

```bash
git add code-graph-ui/src/core/hooks/useChatHistory.ts code-graph-ui/src/core/hooks/index.ts
git commit -m "feat: 添加 useChatHistory hook 管理对话历史"
```

---

## Task 4: 重构 GraphQuery 页面集成对话历史

**Files:**
- Modify: `code-graph-ui/src/pages/GraphQuery/index.tsx`

这是较大的改动，需要重构整个页面布局。主要变更：
1. 添加左侧会话列表面板（可折叠）
2. 将单次查询改为对话形式
3. 显示历史消息列表
4. 添加新建/删除会话功能

- [ ] **Step 1: 重构 GraphQuery 页面**

由于改动较大，完整代码如下：

```typescript
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Alert, message } from 'antd';
import { ragApi } from '../../api/ragApi';
import { useGraphStore } from '../../store/graphStore';
import { useChatHistory } from '../../core/hooks/useChatHistory';
import GraphViewer from '../../components/GraphViewer';
import type { RagQueryResponse } from '../../types/api';
import type { ChatMessage } from '../../types/chat';

const EXAMPLES = [
  '登录功能是如何实现的？',
  '哪些模块依赖了数据库？',
  '用户认证流程涉及哪些函数？',
  '有哪些 Kafka 事件被发布？',
  '最复杂的模块是哪个？',
];

/* ── Node Chip ───────────────────────────────────────────── */
const NodeChip: React.FC<{ label: string; type: string }> = ({ label, type }) => {
  const COLOR_MAP: Record<string, string> = {
    Function: '0,212,255', Module: '0,240,132', Class: '176,142,255',
    Service: '255,193,69', API: '255,69,104', Database: '0,212,255',
  };
  const safeType = type || 'Unknown';
  const rgb = COLOR_MAP[safeType] ?? '110,122,153';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', marginRight: 6, marginBottom: 6, borderRadius: 3,
      background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)`,
      fontFamily: 'var(--font-mono)', fontSize: 11, color: `rgb(${rgb})`,
    }}>
      <span style={{ opacity: 0.6 }}>{safeType.toLowerCase()}</span>
      <span style={{ opacity: 0.3 }}>·</span>
      {label}
    </span>
  );
};

/* ── Confidence Bar ──────────────────────────────────────── */
const ConfBar: React.FC<{ value: number }> = ({ value }) => {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? '#00f084' : pct >= 50 ? '#ffc145' : '#ff4568';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--b-subtle)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color, width: 36 }}>{pct}%</span>
    </div>
  );
};

/* ── Session List Item ───────────────────────────────────── */
const SessionItem: React.FC<{
  session: { id: string; title: string; updatedAt: number; messages: ChatMessage[] };
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}> = ({ session, isActive, onClick, onDelete }) => {
  const timeAgo = Math.floor((Date.now() - session.updatedAt) / 60000);
  const timeStr = timeAgo < 1 ? '刚刚' : timeAgo < 60 ? `${timeAgo}分钟前` : `${Math.floor(timeAgo / 60)}小时前`;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        cursor: 'pointer',
        background: isActive ? 'var(--s-float)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--a-cyan)' : '2px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, color: isActive ? 'var(--t-primary)' : 'var(--t-secondary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {session.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginTop: 4 }}>
            {session.messages.length} 条消息 · {timeStr}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            background: 'transparent', border: 'none', color: 'var(--t-muted)',
            cursor: 'pointer', padding: 2, fontSize: 14, opacity: 0.6,
          }}
          title="删除会话"
        >
          ×
        </button>
      </div>
    </div>
  );
};

/* ── Message Bubble ──────────────────────────────────────── */
const MessageBubble: React.FC<{
  message: ChatMessage;
  onCopyPath: (path: string) => void;
}> = ({ message, onCopyPath }) => {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex', gap: 12,
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
    }}>
      {!isUser && (
        <span style={{
          fontFamily: 'var(--font-mono)', color: 'var(--a-cyan)', fontSize: 12,
          flexShrink: 0, marginTop: 2, filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.5))',
        }}>
          ✦
        </span>
      )}
      <div style={{
        maxWidth: '85%',
        padding: isUser ? '10px 16px' : '14px 18px',
        background: isUser ? 'var(--s-float)' : 'var(--s-raised)',
        border: `1px solid ${isUser ? 'var(--b-subtle)' : 'var(--b-faint)'}`,
        borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
      }}>
        <p style={{
          margin: 0, fontFamily: 'var(--font-ui)', fontSize: 14,
          color: 'var(--t-primary)', lineHeight: 1.75,
        }}>
          {message.content}
        </p>

        {/* AI 回复的附加信息 */}
        {!isUser && message.nodes && message.nodes.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--b-faint)', paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              置信度
            </div>
            <ConfBar value={message.confidence ?? 0} />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                相关节点 · {message.nodes.length}
              </div>
              <div>
                {message.nodes.slice(0, 12).map(n => <NodeChip key={n.id} label={n.label} type={n.type} />)}
                {message.nodes.length > 12 && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-muted)' }}>
                    +{message.nodes.length - 12} 更多
                  </span>
                )}
              </div>
            </div>

            {message.sources && message.sources.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  源文件 · {message.sources.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {message.sources.map((file, i) => (
                    <div
                      key={i}
                      onClick={() => onCopyPath(file)}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--a-cyan)',
                        padding: '4px 8px', background: 'var(--s-float)', borderRadius: 3,
                        border: '1px solid var(--b-faint)', cursor: 'pointer',
                      }}
                      title="点击复制路径"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── GraphQuery Page ─────────────────────────────────────── */
const GraphQuery: React.FC = () => {
  const { activeGraphId } = useGraphStore();
  const {
    sessions,
    currentSession,
    isLoading: sessionsLoading,
    createSession,
    selectSession,
    deleteSession,
    clearAllSessions,
    addUserMessage,
    addAssistantMessage,
    getCurrentSessionMessages,
  } = useChatHistory(activeGraphId);

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [currentResult, setCurrentResult] = useState<RagQueryResponse | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = getCurrentSessionMessages();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { textareaRef.current?.focus(); }, [activeGraphId]);

  // Copy path to clipboard
  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      message.success('路径已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  }, []);

  const handleQuery = async () => {
    if (!question.trim() || !activeGraphId || loading) return;

    const userQuestion = question.trim();
    setQuestion('');
    setError(null);
    setLoading(true);

    // Add user message
    addUserMessage(userQuestion);

    try {
      const res = await ragApi.query({ graphId: activeGraphId, question: userQuestion });

      // Add assistant message with context
      addAssistantMessage(res.answer, {
        nodes: res.nodes,
        edges: res.edges,
        sources: res.sources,
        confidence: res.confidence,
      });

      setCurrentResult(res);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Query failed';
      setError(errMsg);
      // Add error message
      addAssistantMessage(`查询失败: ${errMsg}`, { confidence: 0 });
    } finally {
      setLoading(false);
    }
  };

  const handleNewSession = () => {
    createSession();
    setQuestion('');
    setError(null);
    setCurrentResult(null);
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 0 }}>
      {/* Sidebar - Session List */}
      {showSidebar && (
        <div style={{
          width: 260, flexShrink: 0,
          background: 'var(--s-void)', borderRight: '1px solid var(--b-subtle)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Sidebar Header */}
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid var(--b-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.08em' }}>
              对话历史
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleNewSession}
                style={{
                  background: 'var(--a-cyan)', border: 'none', borderRadius: 3,
                  padding: '4px 10px', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  color: '#07090d',
                }}
              >
                + 新对话
              </button>
              {sessions.length > 0 && (
                <button
                  onClick={clearAllSessions}
                  style={{
                    background: 'transparent', border: '1px solid var(--b-subtle)', borderRadius: 3,
                    padding: '4px 8px', cursor: 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--t-muted)',
                  }}
                  title="清空所有历史"
                >
                  清空
                </button>
              )}
            </div>
          </div>

          {/* Session List */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {sessionsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--t-muted)' }}>
                加载中...
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--t-muted)', fontSize: 12 }}>
                暂无对话历史
              </div>
            ) : (
              sessions
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map(session => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={currentSession?.id === session.id}
                    onClick={() => selectSession(session.id)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid var(--b-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>系统 / AI 查询</div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)' }}>
              AI 代码问答
            </h2>
          </div>
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            style={{
              background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
              borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)',
            }}
          >
            {showSidebar ? '隐藏历史' : '显示历史'}
          </button>
        </div>

        {!activeGraphId && (
          <Alert type="info" message="请从顶栏选择一个仓库后开始查询"
            style={{ margin: 16, borderRadius: 4 }} showIcon />
        )}

        {/* Messages Area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {messages.length === 0 ? (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              justifyContent: 'center', alignItems: 'center', gap: 20,
              color: 'var(--t-muted)',
            }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>◈</div>
              <div style={{ fontSize: 14 }}>输入问题开始对话</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 500 }}>
                {EXAMPLES.map(q => (
                  <button key={q} onClick={() => { setQuestion(q); textareaRef.current?.focus(); }}
                    style={{
                      background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
                      borderRadius: 4, padding: '8px 14px', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)',
                      transition: 'all 0.12s',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} onCopyPath={handleCopyPath} />
              ))}

              {/* Loading indicator */}
              {loading && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                }}>
                  <span style={{ fontSize: 18, animation: 'spin 1s linear infinite', display: 'inline-block' }}>◈</span>
                  <div style={{ color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    正在查询知识图谱...
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <Alert type="error" message={error} showIcon style={{ borderRadius: 4, marginBottom: 16 }} />
              )}

              {/* Graph visualization for latest result */}
              {currentResult?.nodes && currentResult.nodes.length > 0 && !loading && (
                <div style={{
                  marginTop: 16, border: '1px solid var(--b-faint)',
                  borderRadius: 'var(--radius-m)', overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '10px 16px', borderBottom: '1px solid var(--b-faint)',
                    fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                  }}>
                    图谱 · {currentResult.nodes.length} 节点 · {currentResult.edges?.length ?? 0} 边
                  </div>
                  <GraphViewer
                    nodes={currentResult.nodes}
                    edges={currentResult.edges ?? []}
                    layout="force"
                    height={300}
                  />
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid var(--b-subtle)',
          background: 'var(--s-void)',
        }}>
          <div style={{
            background: 'var(--s-raised)', border: '1px solid var(--b-subtle)',
            borderRadius: 'var(--radius-m)', overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 16px 4px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--a-cyan)', fontSize: 13, marginTop: 2, flexShrink: 0 }}>
                ❯
              </span>
              <textarea
                ref={textareaRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); } }}
                placeholder="输入关于代码库的任何问题..."
                disabled={!activeGraphId || loading}
                rows={2}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                  fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-primary)',
                  lineHeight: 1.65, caretColor: 'var(--a-cyan)',
                }}
              />
            </div>
            <div style={{
              padding: '8px 16px 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            }}>
              <button
                onClick={handleQuery}
                disabled={!activeGraphId || !question.trim() || loading}
                style={{
                  background: activeGraphId && question.trim() && !loading ? 'var(--a-cyan)' : 'var(--s-float)',
                  border: '1px solid ' + (activeGraphId && question.trim() && !loading ? 'var(--a-cyan)' : 'var(--b-subtle)'),
                  borderRadius: 3, padding: '6px 18px', cursor: activeGraphId && question.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em',
                  color: activeGraphId && question.trim() && !loading ? '#07090d' : 'var(--t-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {loading ? '查询中...' : '发送 ⏎'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        textarea::placeholder { color: var(--t-muted) !important; }
        textarea:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

export default GraphQuery;
```

- [ ] **Step 2: 验证编译**

```bash
cd code-graph-ui
npm run build
```

Expected: 无编译错误

- [ ] **Step 3: Commit**

```bash
git add code-graph-ui/src/pages/GraphQuery/index.tsx
git commit -m "feat: 重构 GraphQuery 页面，集成对话历史和路径复制功能"
```

---

## Task 5: 最终验证

- [ ] **Step 1: 验证后端 LLM 配置**

```bash
cd code-graph-system
source venv/bin/activate || . venv/Scripts/activate
python -c "
from dotenv import load_dotenv
load_dotenv()
from backend.ai.llm_client import get_default_client
client = get_default_client()
assert client.is_available(), 'LLM client not available'
print('✓ LLM 客户端可用')
"
```

- [ ] **Step 2: 验证前端编译**

```bash
cd code-graph-ui
npm run build
```

Expected: 编译成功

- [ ] **Step 3: 最终提交**

```bash
git add -A
git status
# 确认所有更改已提交
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | 修复 LLM 配置读取 | `backend/ai/llm_client.py` |
| 2 | 创建对话历史类型 | `types/chat.ts` (new) |
| 3 | 创建 useChatHistory hook | `core/hooks/useChatHistory.ts` (new), `core/hooks/index.ts` |
| 4 | 重构 GraphQuery 页面 | `pages/GraphQuery/index.tsx` |

**Expected Outcome:**
1. LLM 客户端能正确读取 `LLM_BASE_URL` 配置
2. 用户可以进行多轮对话，历史记录持久化到 localStorage
3. 点击源文件路径可复制到剪贴板
