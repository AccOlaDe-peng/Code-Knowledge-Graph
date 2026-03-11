import React from 'react';
import ComingSoon from '../../components/ComingSoon';

const EventFlow: React.FC = () => (
  <ComingSoon
    breadcrumb="EVENT FLOW"
    title="Event Flow"
    icon="⚡"
    accent="#ffc145"
    renderer="ECharts"
    description="Visualize async event-driven communication across services. See which components publish and subscribe to Kafka topics, RabbitMQ queues, and other message buses."
    edgeTypes={['publishes', 'subscribes', 'produces', 'consumes']}
    features={[
      { label: 'Topic / Queue Map', desc: 'Event nodes between producers & consumers' },
      { label: 'Kafka & RabbitMQ', desc: 'Detected from EventAnalyzer output' },
      { label: 'Flow Sankey Diagram', desc: 'ECharts Sankey for message volume' },
      { label: 'Orphan Detection', desc: 'Topics with no subscribers highlighted' },
    ]}
  />
);

export default EventFlow;
