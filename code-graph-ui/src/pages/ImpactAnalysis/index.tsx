import React from 'react';
import { Typography, Empty, Alert } from 'antd';
import { RadarChartOutlined } from '@ant-design/icons';
import { useGraphStore } from '../../store/graphStore';

const { Title } = Typography;

const ImpactAnalysis: React.FC = () => {
  const { activeGraphId } = useGraphStore();

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <RadarChartOutlined style={{ marginRight: 8 }} />
        影响分析
      </Title>

      {!activeGraphId ? (
        <Alert
          type="info"
          message="请先在顶部选择一个仓库"
          description="选择仓库后可分析修改某节点对其他模块的影响范围"
          showIcon
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="影响分析（基于图遍历的变更影响评估，即将实现）"
          style={{ padding: '60px 0' }}
        />
      )}
    </div>
  );
};

export default ImpactAnalysis;
