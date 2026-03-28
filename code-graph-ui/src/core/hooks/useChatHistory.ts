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

    // Auto-select most recent session or clear
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
        const now = Date.now()
        const newSession: ChatSession = {
          id: generateId(),
          graphId: graphId!,
          title: truncateTitle(content),
          messages: [{
            id: generateId(),
            role: 'user',
            content,
            timestamp: now,
          }],
          createdAt: now,
          updatedAt: now,
        }

        let newSessions = [...sessions, newSession]
        if (newSessions.length > MAX_SESSIONS_PER_GRAPH) {
          newSessions = newSessions
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_SESSIONS_PER_GRAPH)
        }

        persistSessions(newSessions)
        setCurrentSessionId(newSession.id)
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
    [currentSessionId, sessions, graphId, persistSessions]
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
