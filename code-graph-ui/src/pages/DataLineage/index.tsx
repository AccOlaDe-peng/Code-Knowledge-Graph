import React from 'react';
import { Typography, Empty, Alert } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import { useGraphStore } from '../../store/graphStore';

const { Title } = Typography;

const DataLineage: React.FC = () => {
  const { activeGraphId } = useGraphStore();

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <ShareAltOutlined style={{ marginRight: 8 }} />
        数据血缘
      </Title>

      {!activeGraphId ? (
        <Alert
          type="info"
          message="请先在顶部选择一个仓库"
          description="选择仓库后将展示数据血缘关系图（reads/writes/depends_on）"
          showIcon
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="数据血缘图谱（Cytoscape.js 可视化，即将实现）"
          style={{ padding: '60px 0' }}
        />
      )}
    </div>
  );
};

export default DataLineage;
