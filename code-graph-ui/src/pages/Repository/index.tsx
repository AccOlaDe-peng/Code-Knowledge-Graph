import React, { useState } from 'react';
import { Form, Input, Button, Switch, Select, Alert, Progress } from 'antd';
import { repoApi } from '../../api/repoApi';
import { useRepoStore } from '../../store/repoStore';
import type { AnalyzeRepoRequest, AnalyzeRepoResponse } from '../../types/api';

const LANGS = ['python','typescript','javascript','java','go','rust','cpp','csharp'];

/* ── Toggle Option ───────────────────────────────────────── */
interface ToggleProps { name: string; label: string; desc: string; badge: string; badgeColor: string; }
const ToggleRow: React.FC<ToggleProps> = ({ name, label, desc, badge, badgeColor }) => (
  <Form.Item name={name} valuePropName="checked" style={{ marginBottom: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <Switch />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)', fontWeight: 500 }}>{label}</span>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            padding: '1px 6px', borderRadius: 2,
            background: `rgba(${badgeColor},0.12)`, color: `rgb(${badgeColor})`,
            border: `1px solid rgba(${badgeColor},0.3)`,
          }}>{badge}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  </Form.Item>
);

/* ── Result Row ──────────────────────────────────────────── */
const ResultRow: React.FC<{ k: string; v: string | number }> = ({ k, v }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--b-faint)' }}>
    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{k}</span>
    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--t-cyan)', fontWeight: 500 }}>{v}</span>
  </div>
);

/* ── Repository Page ─────────────────────────────────────── */
const Repository: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeRepoResponse | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const { addRepo } = useRepoStore();

  const handleSubmit = async (values: AnalyzeRepoRequest & { repoPath: string }) => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await repoApi.analyzeRepository({
        repoPath: values.repoPath, repoName: values.repoName,
        languages: values.languages, enableAi: values.enableAi, enableRag: values.enableRag,
      });
      setResult(res);
      addRepo({ graphId: res.graphId, repoName: res.repoName, language: values.languages || [],
        createdAt: new Date().toISOString(), nodeCount: res.nodeCount, edgeCount: res.edgeCount });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally { setLoading(false); }
  };

  return (
    <div>
      {/* Heading */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>SYS / REPOSITORY</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t-primary)', fontFamily: 'var(--font-ui)' }}>Repository Manager</h2>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Form panel */}
        <div style={{
          flex: '0 0 520px', minWidth: 0,
          background: 'var(--s-raised)', border: '1px solid var(--b-subtle)',
          borderRadius: 'var(--radius-m)', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--b-faint)' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              ⬡ Analyze Repository
            </span>
          </div>
          <div style={{ padding: '20px 24px 24px' }}>
            <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
              <Form.Item
                name="repoPath"
                label="REPO PATH"
                rules={[{ required: true, message: 'Path is required' }]}
                style={{ marginBottom: 16 }}
              >
                <Input
                  placeholder="/path/to/your/repository"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </Form.Item>

              <Form.Item name="repoName" label="REPO NAME (optional)" style={{ marginBottom: 16 }}>
                <Input placeholder="auto-detect from path" style={{ fontFamily: 'var(--font-mono)' }} />
              </Form.Item>

              <Form.Item name="languages" label="LANGUAGES (optional)" style={{ marginBottom: 24 }}>
                <Select
                  mode="multiple"
                  placeholder="auto-detect all languages"
                  options={LANGS.map(l => ({ value: l, label: l }))}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </Form.Item>

              {/* Toggles */}
              <div style={{
                padding: '16px', marginBottom: 20,
                background: 'var(--s-float)', borderRadius: 'var(--radius-s)',
                border: '1px solid var(--b-faint)',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}>
                <ToggleRow name="enableAi"  label="AI Semantic Analysis" desc="Requires ANTHROPIC_API_KEY" badge="OPTIONAL" badgeColor="176,142,255" />
                <ToggleRow name="enableRag" label="Vector Retrieval (RAG)" desc="Requires ChromaDB"         badge="OPTIONAL" badgeColor="255,193,69" />
              </div>

              <Button
                type="primary" htmlType="submit" loading={loading} size="large" block
                style={{ height: 44, fontSize: 13, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
              >
                {loading ? 'ANALYZING...' : '⚡ RUN ANALYSIS'}
              </Button>
            </Form>

            {loading && (
              <div style={{ marginTop: 20 }}>
                <Progress percent={99} status="active" showInfo={false} />
                <div style={{ marginTop: 6, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', letterSpacing: '0.06em' }}>
                  parsing AST → building graph → computing metrics...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Result / Info panel */}
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <Alert type="error" message="Analysis Failed" description={
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{error}</span>
            } showIcon closable onClose={() => setError(null)} />
          )}

          {result && (
            <div style={{
              background: 'var(--s-raised)', border: '1px solid rgba(0,240,132,0.2)',
              borderTop: '2px solid var(--a-green)', borderRadius: 'var(--radius-m)',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--b-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--a-green)', boxShadow: '0 0 6px var(--a-green)', display: 'inline-block' }} />
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-green)', letterSpacing: '0.1em' }}>ANALYSIS COMPLETE</span>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <ResultRow k="Graph ID"    v={result.graphId} />
                <ResultRow k="Repo Name"   v={result.repoName} />
                <ResultRow k="Nodes"       v={result.nodeCount.toLocaleString()} />
                <ResultRow k="Edges"       v={result.edgeCount.toLocaleString()} />
                {result.duration && <ResultRow k="Duration" v={`${result.duration.toFixed(2)}s`} />}
              </div>
            </div>
          )}

          {/* Info box */}
          <div style={{
            background: 'var(--s-raised)', border: '1px solid var(--b-faint)',
            borderRadius: 'var(--radius-m)', padding: '16px 18px',
          }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--t-secondary)', letterSpacing: '0.08em', marginBottom: 12, textTransform: 'uppercase' }}>
              Pipeline Steps
            </div>
            {['RepoScanner','CodeParser (Tree-sitter)','ModuleDetector','ComponentDetector','DependencyAnalyzer','CallGraphBuilder','EventAnalyzer','InfraAnalyzer','GraphBuilder','GraphRepository'].map((step, i) => (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: i < 9 ? '1px solid var(--b-faint)' : 'none' }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--t-secondary)' }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Repository;
