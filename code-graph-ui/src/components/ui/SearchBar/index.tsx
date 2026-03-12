import React, { useState, useCallback } from 'react'
import { Input, Select, Space, Tag } from 'antd'
import { SearchOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { GraphNode } from '../../../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchFilter = {
  nodeTypes?: string[]
  properties?: Record<string, string>
}

export type SearchBarProps = {
  nodes: GraphNode[]
  onSearch: (query: string, filters: SearchFilter) => void
  onSelect?: (node: GraphNode) => void
  placeholder?: string
  showTypeFilter?: boolean
}

// ─── SearchBar ────────────────────────────────────────────────────────────────

const SearchBar: React.FC<SearchBarProps> = ({
  nodes,
  onSearch,
  onSelect,
  placeholder = 'Search nodes by name or ID...',
  showTypeFilter = true,
}) => {
  const [query, setQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<GraphNode[]>([])

  // Extract unique node types
  const nodeTypes = Array.from(new Set(nodes.map(n => n.type))).sort()

  // Search handler
  const handleSearch = useCallback(
    (searchQuery: string, types: string[]) => {
      const q = searchQuery.toLowerCase().trim()

      if (!q && types.length === 0) {
        setSearchResults([])
        onSearch('', {})
        return
      }

      const filtered = nodes.filter(node => {
        // Type filter
        if (types.length > 0 && !types.includes(node.type)) {
          return false
        }

        // Text search
        if (q) {
          const matchesLabel = node.label?.toLowerCase().includes(q)
          const matchesId = node.id.toLowerCase().includes(q)
          const matchesType = node.type.toLowerCase().includes(q)
          return matchesLabel || matchesId || matchesType
        }

        return true
      })

      setSearchResults(filtered.slice(0, 50)) // Limit to 50 results
      onSearch(searchQuery, { nodeTypes: types })
    },
    [nodes, onSearch]
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    handleSearch(value, selectedTypes)
  }

  const handleTypeChange = (types: string[]) => {
    setSelectedTypes(types)
    handleSearch(query, types)
  }

  const handleClear = () => {
    setQuery('')
    setSelectedTypes([])
    setSearchResults([])
    onSearch('', {})
  }

  const handleSelectNode = (node: GraphNode) => {
    onSelect?.(node)
    setSearchResults([])
  }

  return (
    <div style={{ position: 'relative' }}>
      <Space.Compact style={{ width: '100%' }}>
        {/* Search input */}
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--t-muted)' }} />}
          suffix={
            (query || selectedTypes.length > 0) && (
              <CloseCircleOutlined
                onClick={handleClear}
                style={{ color: 'var(--t-muted)', cursor: 'pointer' }}
              />
            )
          }
          placeholder={placeholder}
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          style={{ flex: 1 }}
          size="large"
        />

        {/* Type filter */}
        {showTypeFilter && (
          <Select
            mode="multiple"
            placeholder="Filter by type"
            value={selectedTypes}
            onChange={handleTypeChange}
            style={{ minWidth: 180 }}
            size="large"
            maxTagCount="responsive"
            options={nodeTypes.map(type => ({
              label: type,
              value: type,
            }))}
          />
        )}
      </Space.Compact>

      {/* Search results dropdown */}
      {searchResults.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--s-raised)',
            border: '1px solid var(--b-faint)',
            borderRadius: 'var(--radius-m)',
            maxHeight: 400,
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--b-faint)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--t-muted)',
              letterSpacing: '0.08em',
            }}
          >
            {searchResults.length} RESULTS
          </div>

          {searchResults.map(node => (
            <div
              key={node.id}
              onClick={() => handleSelectNode(node)}
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--b-faint)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLElement).style.background =
                  'var(--s-float)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLElement).style.background =
                  'transparent'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <Tag
                  color="blue"
                  style={{
                    margin: 0,
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {node.type}
                </Tag>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--t-primary)',
                    fontWeight: 500,
                  }}
                >
                  {node.label}
                </span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--t-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {node.id}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SearchBar
