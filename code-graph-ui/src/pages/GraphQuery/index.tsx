import React, { useState, useRef, useEffect } from 'react';
import { Alert } from 'antd';
import { ragApi } from '../../api/ragApi';
import { useGraphStore } from '../../store/graphStore';
import GraphViewer from '../../components/GraphViewer';
import type { RagQueryResponse } from '../../types/api';

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
  const rgb = COLOR_MAP[type] ?? '110,122,153';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', marginRight: 6, marginBottom: 6, borderRadius: 3,
      background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)`,
      fontFamily: 'var(--font-mono)', fontSize: 11, color: `rgb(${rgb})`,
    }}>
      <span style={{ opacity: 0.6 }}>{type.toLowerCase()}</span>
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

/* ── GraphQuery Page ─────────────────────────────────────── */
const GraphQuery: React.FC = () => {
  const { activeGraphId } = useGraphStore();
  const [question, setQuestion] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<RagQueryResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, [activeGraphId]);

  const handleQuery = async () => {
    if (!question.trim() || !activeGraphId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await ragApi.query({ graphId: activeGraphId, question });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Heading */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>系统 / AI 查询</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)' }}>
          AI 代码问答
        </h2>
      </div>

      {!activeGraphId && (
        <Alert type="info" message="请从顶栏选择一个仓库后开始查询"
          style={{ marginBottom: 20, borderRadius: 4 }} showIcon />
      )}

      {/* Input terminal */}
      <div style={{
        background: 'var(--s-raised)', border: '1px solid var(--b-subtle)',
        borderRadius: 'var(--radius-m)', overflow: 'hidden', marginBottom: 20,
      }}>
        {/* Terminal titlebar */}
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--b-faint)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4568', display: 'inline-block' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffc145', display: 'inline-block' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00f084', display: 'inline-block' }} />
          <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.06em' }}>
            graphrag — query
          </span>
        </div>

        {/* Prompt line */}
        <div style={{ padding: '14px 18px 4px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
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
            rows={3}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
              fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-primary)',
              lineHeight: 1.65, caretColor: 'var(--a-cyan)',
            }}
          />
        </div>

        {/* Actions bar */}
        <div style={{
          padding: '10px 18px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EXAMPLES.map(q => (
              <button key={q} onClick={() => { setQuestion(q); textareaRef.current?.focus(); }}
                style={{
                  background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
                  borderRadius: 3, padding: '3px 10px', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.borderColor='rgba(0,212,255,0.3)'; (e.target as HTMLElement).style.color='var(--t-cyan)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.borderColor='var(--b-subtle)'; (e.target as HTMLElement).style.color='var(--t-secondary)'; }}
              >
                {q}
              </button>
            ))}
          </div>
          <button
            onClick={handleQuery}
            disabled={!activeGraphId || !question.trim() || loading}
            style={{
              background: activeGraphId && question.trim() && !loading ? 'var(--a-cyan)' : 'var(--s-float)',
              border: '1px solid ' + (activeGraphId && question.trim() && !loading ? 'var(--a-cyan)' : 'var(--b-subtle)'),
              borderRadius: 3, padding: '6px 18px', cursor: activeGraphId && question.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em',
              color: activeGraphId && question.trim() && !loading ? '#07090d' : 'var(--t-muted)',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            {loading ? '...' : '发送 ⏎'}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{
          background: 'var(--s-raised)', border: '1px solid var(--b-faint)',
          borderRadius: 'var(--radius-m)', padding: '28px 24px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <span style={{ fontSize: 20, animation: 'spin 1s linear infinite', display: 'inline-block' }}>◈</span>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-primary)', marginBottom: 4 }}>
              正在查询知识图谱...
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-muted)' }}>
              向量检索 → 图谱展开 → LLM 综合
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <Alert type="error" message={error} showIcon style={{ borderRadius: 4 }} />}

      {/* Result */}
      {result && (
        <div style={{
          background: 'var(--s-raised)', border: '1px solid var(--b-subtle)',
          borderTop: '2px solid var(--a-cyan)', borderRadius: 'var(--radius-m)',
          overflow: 'hidden',
        }}>
          {/* Question echo */}
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid var(--b-faint)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', fontSize: 12, flexShrink: 0, marginTop: 1 }}>Q</span>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--t-secondary)', fontStyle: 'italic' }}>
              {result.question}
            </span>
          </div>

          {/* Answer */}
          <div style={{ padding: '20px', borderBottom: '1px solid var(--b-faint)', display: 'flex', gap: 14 }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--a-cyan)', fontSize: 12, flexShrink: 0, marginTop: 2, filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.5))' }}>✦</span>
            <p style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--t-primary)', lineHeight: 1.75 }}>
              {result.answer}
            </p>
          </div>

          {/* Meta */}
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                置信度
              </div>
              <ConfBar value={result.confidence} />
            </div>

            {result.nodes?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                  相关节点 · {result.nodes.length}
                </div>
                <div>
                  {result.nodes.slice(0, 12).map(n => <NodeChip key={n.id} label={n.label} type={n.type} />)}
                  {result.nodes.length > 12 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-muted)' }}>
                      +{result.nodes.length - 12} 更多
                    </span>
                  )}
                </div>
              </div>
            )}

            {result.sources?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  源文件 · {result.sources.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.sources.map((file, i) => (
                    <div key={i} style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)',
                      padding: '4px 8px', background: 'var(--s-float)', borderRadius: 3,
                      border: '1px solid var(--b-faint)',
                    }}>
                      {file}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Graph visualization */}
          {result.nodes?.length > 0 && (
            <div style={{ borderTop: '1px solid var(--b-faint)' }}>
              <div style={{ padding: '10px 20px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  图谱 · {result.nodes.length} 节点 · {result.edges?.length ?? 0} 边
                </div>
              </div>
              <GraphViewer
                nodes={result.nodes}
                edges={result.edges ?? []}
                layout="force"
                height={340}
              />
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        textarea::placeholder { color: var(--t-muted) !important; }
        textarea:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

export default GraphQuery;
