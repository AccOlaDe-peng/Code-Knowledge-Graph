import React, { useState } from 'react';
import {
  Typography,
  Input,
  Button,
  Card,
  Space,
  Alert,
  Tag,
  Divider,
  Spin,
  Rate,
} from 'antd';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { ragApi } from '../../api/ragApi';
import { useGraphStore } from '../../store/graphStore';
import type { RagQueryResponse } from '../../types/api';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const EXAMPLE_QUESTIONS = [
  '登录功能是如何实现的？',
  '哪些模块依赖了数据库？',
  '用户认证流程涉及哪些函数？',
  '有哪些 Kafka 事件被发布？',
];

const GraphQuery: React.FC = () => {
  const { activeGraphId } = useGraphStore();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RagQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleQuery = async () => {
    if (!question.trim() || !activeGraphId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await ragApi.query({ graphId: activeGraphId, question });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 查询失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <Title level={4} style={{ marginTop: 0 }}>
        <RobotOutlined style={{ marginRight: 8 }} />
        AI 代码问答
      </Title>

      {!activeGraphId && (
        <Alert
          type="info"
          message="请先在顶部选择一个仓库"
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text type="secondary">示例问题：</Text>
          <Space wrap>
            {EXAMPLE_QUESTIONS.map((q) => (
              <Tag
                key={q}
                style={{ cursor: 'pointer' }}
                color="blue"
                onClick={() => setQuestion(q)}
              >
                {q}
              </Tag>
            ))}
          </Space>
          <TextArea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="输入关于代码库的问题，例如：某功能是如何实现的？"
            rows={3}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleQuery();
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={loading}
            disabled={!activeGraphId || !question.trim()}
            onClick={handleQuery}
          >
            提问
          </Button>
        </Space>
      </Card>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">AI 正在分析代码图谱...</Text>
          </div>
        </div>
      )}

      {error && (
        <Alert type="error" message={error} style={{ marginTop: 16 }} showIcon />
      )}

      {result && (
        <Card style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Text strong style={{ fontSize: 15 }}>
                问：{result.question}
              </Text>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <Space align="start">
                <RobotOutlined style={{ color: '#1677ff', fontSize: 18, marginTop: 2 }} />
                <div>
                  <Paragraph style={{ marginBottom: 0 }}>{result.answer}</Paragraph>
                </div>
              </Space>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <Space wrap>
              <Text type="secondary">置信度：</Text>
              <Rate disabled defaultValue={Math.round(result.confidence * 5)} />
              <Text type="secondary">({(result.confidence * 100).toFixed(0)}%)</Text>
            </Space>

            {result.nodes?.length > 0 && (
              <div>
                <Text type="secondary">相关节点：</Text>
                <div style={{ marginTop: 8 }}>
                  {result.nodes.slice(0, 10).map((node) => (
                    <Tag key={node.id} color="geekblue" style={{ marginBottom: 4 }}>
                      {node.label} ({node.type})
                    </Tag>
                  ))}
                  {result.nodes.length > 10 && (
                    <Tag>+{result.nodes.length - 10} 更多</Tag>
                  )}
                </div>
              </div>
            )}
          </Space>
        </Card>
      )}
    </div>
  );
};

export default GraphQuery;
