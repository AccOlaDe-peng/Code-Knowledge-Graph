import React, { useCallback, useEffect, useRef, useState } from 'react'
import { CloseOutlined, SearchOutlined } from '@ant-design/icons'
import { useGraphEngineStore } from '../../graph-engine/store'
import type { EngineGraphNode } from '../../graph-engine/types'
import { getNodeTypeColor } from '../../theme'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphSearchProps = {
  onSelectNode: (node: EngineGraphNode) => void
  onClose: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RESULTS = 50
const DEBOUNCE_MS = 150

// ─── GraphSearch ──────────────────────────────────────────────────────────────

export const GraphSearch: React.FC<GraphSearchProps> = ({ onSelectNode, onClose }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EngineGraphNode[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const nodes = useGraphEngineStore(s => s.nodes)
  const setSearchQuery = useGraphEngineStore(s => s.setSearchQuery)
  const setHighlighted = useGraphEngineStore(s => s.setHighlighted)
  const clearSearch = useGraphEngineStore(s => s.clearSearch)

  // Focus on mount; clear search on unmount
  useEffect(() => {
    inputRef.current?.focus()
    return () => { clearSearch() }
  // clearSearch is a stable Zustand action — intentional empty-like dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = query.trim().toLowerCase()
      if (!q) {
        setResults([])
        clearSearch()
        return
      }

      const hits: EngineGraphNode[] = []
      for (const node of nodes.values()) {
        if (
          node.label.toLowerCase().includes(q) ||
          node.id.toLowerCase().includes(q) ||
          node.type.toLowerCase().includes(q)
        ) {
          hits.push(node)
          if (hits.length >= MAX_RESULTS) break
        }
      }

      setResults(hits)
      setSearchQuery(query)
      setHighlighted(hits.map(n => n.id))
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, nodes])

  const handleSelect = useCallback(
    (node: EngineGraphNode) => {
      onSelectNode(node)
      setQuery('')
      setResults([])
      clearSearch()
    },
    [onSelectNode, clearSearch],
  )

  const handleClear = useCallback(() => {
    setQuery('')
    setResults([])
    clearSearch()
    inputRef.current?.focus()
  }, [clearSearch])

  return (
    <div style={{
      width: 320,
      background: '#0e1520',
      border: '1px solid rgba(0,212,255,0.25)',
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,255,0.08)',
    }}>
      {/* ── Search input ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: results.length > 0 || (query && results.length === 0)
          ? '1px solid rgba(255,255,255,0.05)'
          : 'none',
      }}>
        <SearchOutlined style={{ color: '#00d4ff', fontSize: 13, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && results.length > 0) handleSelect(results[0])
          }}
          placeholder="Search nodes by name, type, ID..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#e8ecf8',
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 12,
            caretColor: '#00d4ff',
          }}
        />
        {query ? (
          <button
            onClick={handleClear}
            title="Clear"
            style={clearBtnStyle}
          >
            <CloseOutlined style={{ fontSize: 10 }} />
          </button>
        ) : (
          <button
            onClick={onClose}
            title="Close"
            style={clearBtnStyle}
          >
            <CloseOutlined style={{ fontSize: 10 }} />
          </button>
        )}
      </div>

      {/* ── Results list ───────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {results.map((node, i) => (
            <ResultRow
              key={node.id}
              node={node}
              onSelect={handleSelect}
              isFirst={i === 0}
            />
          ))}
          {results.length === MAX_RESULTS && (
            <div style={footerStyle}>
              Showing first {MAX_RESULTS} results — refine your query
            </div>
          )}
        </div>
      )}

      {/* ── No results ─────────────────────────────────────────────────── */}
      {query.trim() && results.length === 0 && (
        <div style={{
          padding: '14px 12px',
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 11,
          color: '#6b7a9d',
          textAlign: 'center',
          letterSpacing: '0.06em',
        }}>
          NO NODES FOUND
        </div>
      )}
    </div>
  )
}

// ─── ResultRow ────────────────────────────────────────────────────────────────

const ResultRow: React.FC<{
  node: EngineGraphNode
  onSelect: (node: EngineGraphNode) => void
  isFirst: boolean
}> = ({ node, onSelect, isFirst }) => {
  const color = getNodeTypeColor(node.type)

  return (
    <div
      onClick={() => onSelect(node)}
      data-result-row
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        background: isFirst ? 'rgba(0,212,255,0.04)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,212,255,0.08)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background =
          isFirst ? 'rgba(0,212,255,0.04)' : 'transparent'
      }}
    >
      {/* Type dot */}
      <span style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color.primary,
        boxShadow: `0 0 4px ${color.primary}`,
        flexShrink: 0,
      }} />

      {/* Label */}
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        color: '#c8d4e8',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {node.label}
      </span>

      {/* Type badge */}
      <span style={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 9,
        color: color.primary,
        background: color.dim,
        border: `1px solid ${color.border}40`,
        borderRadius: 3,
        padding: '1px 5px',
        flexShrink: 0,
        letterSpacing: '0.06em',
      }}>
        {node.type}
      </span>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const clearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#6b7a9d',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 2,
  borderRadius: 3,
  transition: 'color 0.1s',
  flexShrink: 0,
}

const footerStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 9,
  color: '#4a5a6a',
  letterSpacing: '0.06em',
  textAlign: 'center',
  borderTop: '1px solid rgba(255,255,255,0.04)',
}
