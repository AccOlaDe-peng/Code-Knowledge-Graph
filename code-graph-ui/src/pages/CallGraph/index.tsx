import React from 'react';
import { Typography, Empty, Alert } from 'antd';
import { NodeIndexOutlined } from '@ant-design/icons';
import { useGraphStore } from '../../store/graphStore';

const { Title } = Typography;

const CallGraph: React.FC = () => {
  const { activeGraphId } = useGraphStore();

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <NodeIndexOutlined style={{ marginRight: 8 }} />
        函数调用图
      </Title>

      {!activeGraphId ? (
        <Alert
          type="info"
          message="请先在顶部选择一个仓库"
          description="选择仓库后将展示函数调用关系图"
          showIcon
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="函数调用图谱（ReactFlow 可视化，即将实现）"
          style={{ padding: '60px 0' }}
        />
      )}
    </div>
  );
};

export default CallGraph;
