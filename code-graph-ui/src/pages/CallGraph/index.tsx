import React from 'react';
import ComingSoon from '../../components/ComingSoon';

const CallGraph: React.FC = () => (
  <ComingSoon
    breadcrumb="CALL GRAPH"
    title="Call Graph"
    icon="⇢"
    accent="#00f084"
    renderer="ReactFlow"
    description="Trace function-level call chains across your entire codebase. Visualize hot paths, dead code, and entry points. Powered by CallGraphBuilder using Tree-sitter AST analysis."
    edgeTypes={['calls']}
    features={[
      { label: 'Animated Call Edges', desc: 'Directed edges with flow animation' },
      { label: 'PageRank Hotspot', desc: 'Node size = PageRank centrality score' },
      { label: 'Depth-limited Traversal', desc: 'Expand call chains N levels deep' },
      { label: 'Dead Code Detection', desc: 'Highlight functions with zero in-degree' },
    ]}
  />
);

export default CallGraph;
