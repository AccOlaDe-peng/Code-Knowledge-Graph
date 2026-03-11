import React from 'react';
import ComingSoon from '../../components/ComingSoon';

const ImpactAnalysis: React.FC = () => (
  <ComingSoon
    breadcrumb="IMPACT"
    title="Impact Analysis"
    icon="◎"
    accent="#ff4568"
    renderer="ECharts + ReactFlow"
    description="Select any node to compute the blast radius of a change. Performs bidirectional graph traversal to identify all directly and transitively affected modules, services, and functions."
    features={[
      { label: 'Blast Radius Computation', desc: 'BFS/DFS from selected node' },
      { label: 'Severity Heatmap', desc: 'Color by traversal depth (red = direct)' },
      { label: 'Risk Scoring', desc: 'Weighted by PageRank + in-degree' },
      { label: 'Change Report Export', desc: 'JSON/Markdown summary of affected nodes' },
    ]}
  />
);

export default ImpactAnalysis;
