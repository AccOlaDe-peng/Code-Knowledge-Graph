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
