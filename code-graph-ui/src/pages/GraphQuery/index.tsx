import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Alert, message } from 'antd';
import { ragApi } from '../../api/ragApi';
import { useGraphStore } from '../../store/graphStore';
import { useChatHistory } from '../../core/hooks/useChatHistory';
import GraphViewer from '../../components/GraphViewer';
import type { RagQueryResponse } from '../../types/api';
import type { ChatMessage } from '../../types/chat';

const EXAMPLES = [
  '登录功能是如何实现的？',
  '哪些模块依赖了数据库？',
  '用户认证流程涉及哪些函数？',
  '有哪些 Kafka 事件被发布？',
  '最复杂的模块是哪个？',
];

/* ── Node Chip ───────────────────────────────────────────── */
const NodeChip: React.FC<{ label: string; type: string }> = ({ label, type }) => {
  const COLOR_MAP: Record<string, string> = {
    Function: '0,212,255', Module: '0,240,132', Class: '176,142,255',
    Service: '255,193,69', API: '255,69,104', Database: '0,212,255',
  };
  const safeType = type || 'Unknown';
  const rgb = COLOR_MAP[safeType] ?? '110,122,153';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', marginRight: 6, marginBottom: 6, borderRadius: 3,
      background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)`,
      fontFamily: 'var(--font-mono)', fontSize: 11, color: `rgb(${rgb})`,
    }}>
      <span style={{ opacity: 0.6 }}>{safeType.toLowerCase()}</span>
      <span style={{ opacity: 0.3 }}>·</span>
      {label}
    </span>
  );
};

/* ── Confidence Bar ──────────────────────────────────────── */
const ConfBar: React.FC<{ value: number }> = ({ value }) => {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? '#00f084' : pct >= 50 ? '#ffc145' : '#ff4568';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--b-subtle)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color, width: 36 }}>{pct}%</span>
    </div>
  );
};

/* ── Session List Item ───────────────────────────────────── */
const SessionItem: React.FC<{
  session: { id: string; title: string; updatedAt: number; messages: ChatMessage[] };
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}> = ({ session, isActive, onClick, onDelete }) => {
  const timeAgo = Math.floor((Date.now() - session.updatedAt) / 60000);
  const timeStr = timeAgo < 1 ? '刚刚' : timeAgo < 60 ? `${timeAgo}分钟前` : `${Math.floor(timeAgo / 60)}小时前`;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        cursor: 'pointer',
        background: isActive ? 'var(--s-float)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--a-cyan)' : '2px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, color: isActive ? 'var(--t-primary)' : 'var(--t-secondary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {session.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginTop: 4 }}>
            {session.messages.length} 条消息 · {timeStr}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            background: 'transparent', border: 'none', color: 'var(--t-muted)',
            cursor: 'pointer', padding: 2, fontSize: 14, opacity: 0.6,
          }}
          title="删除会话"
        >
          ×
        </button>
      </div>
    </div>
  );
};

/* ── Message Bubble ──────────────────────────────────────── */
const MessageBubble: React.FC<{
  message: ChatMessage;
  onCopyPath: (path: string) => void;
}> = ({ message, onCopyPath }) => {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex', gap: 12,
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
    }}>
      {!isUser && (
        <span style={{
          fontFamily: 'var(--font-mono)', color: 'var(--a-cyan)', fontSize: 12,
          flexShrink: 0, marginTop: 2, filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.5))',
        }}>
          ✦
        </span>
      )}
      <div style={{
        maxWidth: '85%',
        padding: isUser ? '10px 16px' : '14px 18px',
        background: isUser ? 'var(--s-float)' : 'var(--s-raised)',
        border: `1px solid ${isUser ? 'var(--b-subtle)' : 'var(--b-faint)'}`,
        borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
      }}>
        <p style={{
          margin: 0, fontFamily: 'var(--font-ui)', fontSize: 14,
          color: 'var(--t-primary)', lineHeight: 1.75,
        }}>
          {message.content}
        </p>

        {/* AI 回复的附加信息 */}
        {!isUser && message.nodes && message.nodes.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--b-faint)', paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              置信度
            </div>
            <ConfBar value={message.confidence ?? 0} />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                相关节点 · {message.nodes.length}
              </div>
              <div>
                {message.nodes.slice(0, 12).map(n => <NodeChip key={n.id} label={n.label} type={n.type} />)}
                {message.nodes.length > 12 && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-muted)' }}>
                    +{message.nodes.length - 12} 更多
                  </span>
                )}
              </div>
            </div>

            {message.sources && message.sources.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  源文件 · {message.sources.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {message.sources.map((file, i) => (
                    <div
                      key={i}
                      onClick={() => onCopyPath(file)}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--a-cyan)',
                        padding: '4px 8px', background: 'var(--s-float)', borderRadius: 3,
                        border: '1px solid var(--b-faint)', cursor: 'pointer',
                      }}
                      title="点击复制路径"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── GraphQuery Page ─────────────────────────────────────── */
const GraphQuery: React.FC = () => {
  const { activeGraphId } = useGraphStore();
  const {
    sessions,
    currentSession,
    isLoading: sessionsLoading,
    createSession,
    selectSession,
    deleteSession,
    clearAllSessions,
    addUserMessage,
    addAssistantMessage,
    getCurrentSessionMessages,
  } = useChatHistory(activeGraphId);

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [currentResult, setCurrentResult] = useState<RagQueryResponse | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = getCurrentSessionMessages();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { textareaRef.current?.focus(); }, [activeGraphId]);

  // Copy path to clipboard
  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      message.success('路径已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  }, []);

  const handleQuery = async () => {
    if (!question.trim() || !activeGraphId || loading) return;

    const userQuestion = question.trim();
    setQuestion('');
    setError(null);
    setLoading(true);

    // Add user message
    addUserMessage(userQuestion);

    try {
      const res = await ragApi.query({ graphId: activeGraphId, question: userQuestion });

      // Add assistant message with context
      addAssistantMessage(res.answer, {
        nodes: res.nodes,
        edges: res.edges,
        sources: res.sources,
        confidence: res.confidence,
      });

      setCurrentResult(res);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Query failed';
      setError(errMsg);
      // Add error message
      addAssistantMessage(`查询失败: ${errMsg}`, { confidence: 0 });
    } finally {
      setLoading(false);
    }
  };

  const handleNewSession = () => {
    createSession();
    setQuestion('');
    setError(null);
    setCurrentResult(null);
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 0 }}>
      {/* Sidebar - Session List */}
      {showSidebar && (
        <div style={{
          width: 260, flexShrink: 0,
          background: 'var(--s-void)', borderRight: '1px solid var(--b-subtle)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Sidebar Header */}
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid var(--b-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.08em' }}>
              对话历史
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleNewSession}
                style={{
                  background: 'var(--a-cyan)', border: 'none', borderRadius: 3,
                  padding: '4px 10px', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  color: '#07090d',
                }}
              >
                + 新对话
              </button>
              {sessions.length > 0 && (
                <button
                  onClick={clearAllSessions}
                  style={{
                    background: 'transparent', border: '1px solid var(--b-subtle)', borderRadius: 3,
                    padding: '4px 8px', cursor: 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--t-muted)',
                  }}
                  title="清空所有历史"
                >
                  清空
                </button>
              )}
            </div>
          </div>

          {/* Session List */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {sessionsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--t-muted)' }}>
                加载中...
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--t-muted)', fontSize: 12 }}>
                暂无对话历史
              </div>
            ) : (
              sessions
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map(session => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={currentSession?.id === session.id}
                    onClick={() => selectSession(session.id)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid var(--b-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>系统 / AI 查询</div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)' }}>
              AI 代码问答
            </h2>
          </div>
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            style={{
              background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
              borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)',
            }}
          >
            {showSidebar ? '隐藏历史' : '显示历史'}
          </button>
        </div>

        {!activeGraphId && (
          <Alert type="info" message="请从顶栏选择一个仓库后开始查询"
            style={{ margin: 16, borderRadius: 4 }} showIcon />
        )}

        {/* Messages Area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {messages.length === 0 ? (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              justifyContent: 'center', alignItems: 'center', gap: 20,
              color: 'var(--t-muted)',
            }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>◈</div>
              <div style={{ fontSize: 14 }}>输入问题开始对话</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 500 }}>
                {EXAMPLES.map(q => (
                  <button key={q} onClick={() => { setQuestion(q); textareaRef.current?.focus(); }}
                    style={{
                      background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
                      borderRadius: 4, padding: '8px 14px', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)',
                      transition: 'all 0.12s',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} onCopyPath={handleCopyPath} />
              ))}

              {/* Loading indicator */}
              {loading && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                }}>
                  <span style={{ fontSize: 18, animation: 'spin 1s linear infinite', display: 'inline-block' }}>◈</span>
                  <div style={{ color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    正在查询知识图谱...
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <Alert type="error" message={error} showIcon style={{ borderRadius: 4, marginBottom: 16 }} />
              )}

              {/* Graph visualization for latest result */}
              {currentResult?.nodes && currentResult.nodes.length > 0 && !loading && (
                <div style={{
                  marginTop: 16, border: '1px solid var(--b-faint)',
                  borderRadius: 'var(--radius-m)', overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '10px 16px', borderBottom: '1px solid var(--b-faint)',
                    fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                  }}>
                    图谱 · {currentResult.nodes.length} 节点 · {currentResult.edges?.length ?? 0} 边
                  </div>
                  <GraphViewer
                    nodes={currentResult.nodes}
                    edges={currentResult.edges ?? []}
                    layout="force"
                    height={300}
                  />
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid var(--b-subtle)',
          background: 'var(--s-void)',
        }}>
          <div style={{
            background: 'var(--s-raised)', border: '1px solid var(--b-subtle)',
            borderRadius: 'var(--radius-m)', overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 16px 4px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--a-cyan)', fontSize: 13, marginTop: 2, flexShrink: 0 }}>
                ❯
              </span>
              <textarea
                ref={textareaRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); } }}
                placeholder="输入关于代码库的任何问题..."
                disabled={!activeGraphId || loading}
                rows={2}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                  fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-primary)',
                  lineHeight: 1.65, caretColor: 'var(--a-cyan)',
                }}
              />
            </div>
            <div style={{
              padding: '8px 16px 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            }}>
              <button
                onClick={handleQuery}
                disabled={!activeGraphId || !question.trim() || loading}
                style={{
                  background: activeGraphId && question.trim() && !loading ? 'var(--a-cyan)' : 'var(--s-float)',
                  border: '1px solid ' + (activeGraphId && question.trim() && !loading ? 'var(--a-cyan)' : 'var(--b-subtle)'),
                  borderRadius: 3, padding: '6px 18px', cursor: activeGraphId && question.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em',
                  color: activeGraphId && question.trim() && !loading ? '#07090d' : 'var(--t-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {loading ? '查询中...' : '发送 ⏎'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        textarea::placeholder { color: var(--t-muted) !important; }
        textarea:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

export default GraphQuery;
