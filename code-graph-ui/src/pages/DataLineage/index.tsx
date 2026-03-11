import React from 'react';
import ComingSoon from '../../components/ComingSoon';

const DataLineage: React.FC = () => (
  <ComingSoon
    breadcrumb="DATA LINEAGE"
    title="Data Lineage"
    icon="⊞"
    accent="#b08eff"
    renderer="Cytoscape.js"
    description="Track how data flows through your system — from source to destination. Understand which services read from or write to databases, and how data transformations propagate."
    edgeTypes={['reads', 'writes', 'depends_on', 'produces', 'consumes']}
    features={[
      { label: 'Source-to-Sink Paths', desc: 'Trace complete data flow end-to-end' },
      { label: 'Database Access Map', desc: 'Which components touch which stores' },
      { label: 'Cytoscape.js Layout', desc: 'Dagre hierarchical layout for DAGs' },
      { label: 'Impact Highlighting', desc: 'Color nodes by upstream/downstream depth' },
    ]}
  />
);

export default DataLineage;
