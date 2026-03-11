import React from 'react';
import { Typography, Empty, Alert } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useGraphStore } from '../../store/graphStore';

const { Title } = Typography;

const EventFlow: React.FC = () => {
  const { activeGraphId } = useGraphStore();

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <ThunderboltOutlined style={{ marginRight: 8 }} />
        事件流
      </Title>

      {!activeGraphId ? (
        <Alert
          type="info"
          message="请先在顶部选择一个仓库"
          description="选择仓库后将展示 Kafka/RabbitMQ 事件发布订阅关系"
          showIcon
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="事件流图谱（ECharts 可视化，即将实现）"
          style={{ padding: '60px 0' }}
        />
      )}
    </div>
  );
};

export default EventFlow;
