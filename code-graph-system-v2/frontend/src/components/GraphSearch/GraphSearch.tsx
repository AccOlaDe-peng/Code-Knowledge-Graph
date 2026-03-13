import React, { useState, useMemo } from 'react';
import Fuse from 'fuse.js';
import { GraphNode } from '../../types/graph';

interface GraphSearchProps {
  nodes: GraphNode[];
  onNodeSelect: (node: GraphNode) => void;
}

export function GraphSearch({ nodes, onNodeSelect }: GraphSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Setup Fuse.js for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(nodes, {
      keys: ['name', 'type', 'id'],
      threshold: 0.3,
      includeScore: true,
    });
  }, [nodes]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const results = fuse.search(searchQuery);
    return results.slice(0, 10).map(result => result.item);
  }, [searchQuery, fuse]);

  const handleSelect = (node: GraphNode) => {
    onNodeSelect(node);
    setSearchQuery('');
    setIsOpen(false);
  };

  return (
    <div style={containerStyle}>
      <input
        type="text"
        placeholder="Search nodes (function, class, file...)"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        style={inputStyle}
      />

      {isOpen && searchResults.length > 0 && (
        <div style={resultsStyle}>
          {searchResults.map(node => (
            <div
              key={node.id}
              onClick={() => handleSelect(node)}
              style={resultItemStyle}
            >
              <div style={nodeTypeStyle}>{node.type}</div>
              <div style={nodeNameStyle}>{node.name}</div>
              <div style={nodeIdStyle}>{node.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: 20,
  zIndex: 1000,
  width: '400px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '8px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  outline: 'none',
};

const resultsStyle: React.CSSProperties = {
  marginTop: '8px',
  background: 'white',
  border: '1px solid #ccc',
  borderRadius: '8px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  maxHeight: '400px',
  overflowY: 'auto',
};

const resultItemStyle: React.CSSProperties = {
  padding: '12px 16px',
  cursor: 'pointer',
  borderBottom: '1px solid #f0f0f0',
  transition: 'background 0.2s',
};

const nodeTypeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#666',
  textTransform: 'uppercase',
  marginBottom: '4px',
};

const nodeNameStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  marginBottom: '4px',
};

const nodeIdStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#999',
  fontFamily: 'monospace',
};
