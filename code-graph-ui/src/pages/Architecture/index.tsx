import React from 'react';
import ComingSoon from '../../components/ComingSoon';

const Architecture: React.FC = () => (
  <ComingSoon
    breadcrumb="ARCHITECTURE"
    title="Architecture View"
    icon="⌥"
    accent="#00d4ff"
    renderer="ReactFlow"
    description="Visualize module-level dependencies and component relationships as an interactive force-directed graph. Identify tightly-coupled clusters, circular dependencies, and architectural hotspots."
    edgeTypes={['contains', 'depends_on', 'imports']}
    features={[
      { label: 'Module Dependency Graph', desc: 'Interactive ReactFlow canvas with pan/zoom' },
      { label: 'Circular Dependency Detection', desc: 'Highlighted cycles from DependencyAnalyzer' },
      { label: 'Cluster Layout', desc: 'Auto-group by directory / service boundary' },
      { label: 'Node Detail Panel', desc: 'Click any node to inspect properties & neighbors' },
    ]}
  />
);

export default Architecture;
