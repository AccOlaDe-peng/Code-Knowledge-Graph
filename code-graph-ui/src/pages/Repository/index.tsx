import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Form, Input, Button, Switch, Select, Alert, Progress, Popconfirm, Tag } from 'antd'
import { PlusOutlined, ReloadOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons'
import { repoApi } from '../../api/repoApi'
import { useRepoStore } from '../../store/repoStore'
import { useGraphStore } from '../../store/graphStore'
import type { AnalyzeRepoRequest, AnalyzeRepoResponse, RepoInfo } from '../../types/api'

const LANGS = ['python', 'typescript', 'javascript', 'java', 'go', 'rust', 'cpp', 'csharp']

// ─── Status Badge ─────────────────────────────────────────────────────────────

type StatusBadgeProps = { status: 'completed' | 'pending' | 'analyzing' }

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = {
    completed: { label: 'COMPLETED', color: '#00f084', bg: 'rgba(0,240,132,0.1)', border: 'rgba(0,240,132,0.3)' },
    pending:   { label: 'PENDING',   color: '#ffc145', bg: 'rgba(255,193,69,0.1)', border: 'rgba(255,193,69,0.3)' },
    analyzing: { label: 'ANALYZING', color: '#00d4ff', bg: 'rgba(0,212,255,0.1)', border: 'rgba(0,212,255,0.3)' },
  }[status]

  return (
    <div style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           6,
      padding:       '3px 10px',
      borderRadius:  3,
      background:    config.bg,
      border:        `1px solid ${config.border}`,
    }}>
      <span style={{
        width:      5,
        height:     5,
        borderRadius: '50%',
        background: config.color,
        boxShadow:  status === 'analyzing' ? `0 0 6px ${config.color}` : 'none',
      }} />
      <span style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      9,
        color:         config.color,
        letterSpacing: '0.08em',
      }}>
        {config.label}
      </span>
    </div>
  )
}

// ─── Repository Page ──────────────────────────────────────────────────────────

const Repository: React.FC = () => {
  const navigate = useNavigate()
  const { repos, addRepo, removeRepo } = useRepoStore()
  const { setActiveGraphId } = useGraphStore()

  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeRepoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Handle add repository ─────────────────────────────────────────────────

  const handleSubmit = async (values: AnalyzeRepoRequest & { repoPath: string }) => {
    setAnalyzing(true)
    setError(null)
    setResult(null)

    try {
      const res = await repoApi.analyzeRepository({
        repoPath:  values.repoPath,
        repoName:  values.repoName,
        languages: values.languages,
        enableAi:  values.enableAi ?? false,
        enableRag: values.enableRag ?? false,
      })

      setResult(res)
      addRepo({
        graphId:   res.graphId,
        repoName:  res.repoName,
        language:  values.languages || [],
        createdAt: new Date().toISOString(),
        nodeCount: res.nodeCount,
        edgeCount: res.edgeCount,
      })

      // Auto-close modal after 2s
      setTimeout(() => {
        setModalOpen(false)
        form.resetFields()
        setResult(null)
      }, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Handle re-analyze ─────────────────────────────────────────────────────

  const handleReanalyze = async (repo: RepoInfo) => {
    // In a real app, you'd need to store the original repoPath
    // For now, just show a message
    Modal.info({
      title: 'Re-analyze Repository',
      content: `Re-analysis for "${repo.repoName}" would be triggered here. The original repo path needs to be stored for this feature.`,
    })
  }

  // ── Handle view graph ─────────────────────────────────────────────────────

  const handleViewGraph = (repo: RepoInfo) => {
    setActiveGraphId(repo.graphId)
    navigate('/architecture')
  }

  // ── Handle delete ─────────────────────────────────────────────────────────

  const handleDelete = (graphId: string) => {
    removeRepo(graphId)
  }

  return (
    <div>
      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'flex-end',
        justifyContent: 'space-between',
        marginBottom:   24,
      }}>
        <div>
          <div style={{
            fontSize:      9,
            fontFamily:    'var(--font-mono)',
            color:         'var(--t-muted)',
            letterSpacing: '0.15em',
            marginBottom:  4,
          }}>
            SYS / REPOSITORY
          </div>
          <h2 style={{
            margin:        0,
            fontSize:      22,
            fontWeight:    700,
            color:         'var(--t-primary)',
            fontFamily:    'var(--font-ui)',
            letterSpacing: '-0.01em',
          }}>
            Repository Manager
          </h2>
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{
            height:        40,
            fontSize:      13,
            fontFamily:    'var(--font-mono)',
            letterSpacing: '0.06em',
            display:       'flex',
            alignItems:    'center',
            gap:           8,
          }}
        >
          ADD REPOSITORY
        </Button>
      </div>

      {/* ── Repository table ──────────────────────────────────────────────── */}
      <div style={{
        background:   'var(--s-raised)',
        border:       '1px solid var(--b-faint)',
        borderRadius: 'var(--radius-m)',
        overflow:     'hidden',
      }}>
        {/* Table header */}
        <div style={{
          padding:      '14px 20px',
          borderBottom: '1px solid var(--b-faint)',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      10,
            color:         'var(--t-secondary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Repositories
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   10,
            color:      'var(--t-muted)',
          }}>
            {repos.length} total
          </div>
        </div>

        {/* Empty state */}
        {repos.length === 0 && (
          <div style={{
            padding:        '60px 40px',
            textAlign:      'center',
          }}>
            <div style={{ fontSize: 48, opacity: 0.08, marginBottom: 16 }}>⬡</div>
            <div style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      11,
              color:         'var(--t-muted)',
              letterSpacing: '0.1em',
              marginBottom:  12,
            }}>
              NO REPOSITORIES YET
            </div>
            <Button
              type="link"
              onClick={() => setModalOpen(true)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize:   11,
                color:      'var(--t-cyan)',
              }}
            >
              Add your first repository →
            </Button>
          </div>
        )}

        {/* Table rows */}
        {repos.length > 0 && (
          <div>
            {/* Column headers */}
            <div style={{
              display:               'grid',
              gridTemplateColumns:   '2fr 1fr 1fr 1.5fr 1.5fr',
              gap:                   16,
              padding:               '12px 20px',
              background:            'var(--s-float)',
              borderBottom:          '1px solid var(--b-faint)',
            }}>
              {['NAME', 'BRANCH', 'STATUS', 'LAST ANALYSIS', 'ACTIONS'].map(h => (
                <div key={h} style={{
                  fontFamily:    'var(--font-mono)',
                  fontSize:      9,
                  color:         'var(--t-muted)',
                  letterSpacing: '0.12em',
                }}>
                  {h}
                </div>
              ))}
            </div>

            {/* Data rows */}
            {repos.map((repo, i) => (
              <div
                key={repo.graphId}
                style={{
                  display:             'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1.5fr',
                  gap:                 16,
                  padding:             '16px 20px',
                  borderBottom:        i < repos.length - 1 ? '1px solid var(--b-faint)' : 'none',
                  transition:          'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--s-float)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Name */}
                <div>
                  <div style={{
                    fontFamily:   'var(--font-mono)',
                    fontSize:     13,
                    fontWeight:   500,
                    color:        'var(--t-cyan)',
                    marginBottom: 4,
                  }}>
                    {repo.repoName}
                  </div>
                  <div style={{
                    display:   'flex',
                    gap:       4,
                    flexWrap:  'wrap',
                  }}>
                    {repo.language.slice(0, 3).map(lang => (
                      <Tag
                        key={lang}
                        style={{
                          margin:        0,
                          fontSize:      9,
                          fontFamily:    'var(--font-mono)',
                          background:    'rgba(176,142,255,0.08)',
                          border:        '1px solid rgba(176,142,255,0.2)',
                          color:         '#b08eff',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {lang}
                      </Tag>
                    ))}
                    {repo.language.length > 3 && (
                      <span style={{
                        fontSize:   9,
                        fontFamily: 'var(--font-mono)',
                        color:      'var(--t-muted)',
                      }}>
                        +{repo.language.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                {/* Branch */}
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   12,
                  color:      'var(--t-secondary)',
                }}>
                  {repo.gitCommit ? (
                    <div>
                      <div style={{ marginBottom: 2 }}>main</div>
                      <div style={{
                        fontSize:      9,
                        color:         'var(--t-muted)',
                        letterSpacing: '0.02em',
                      }}>
                        {repo.gitCommit.slice(0, 7)}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--t-muted)' }}>—</span>
                  )}
                </div>

                {/* Status */}
                <div>
                  <StatusBadge status={repo.graphId ? 'completed' : 'pending'} />
                </div>

                {/* Last Analysis */}
                <div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize:   11,
                    color:      'var(--t-secondary)',
                    marginBottom: 2,
                  }}>
                    {new Date(repo.createdAt).toLocaleDateString('zh-CN', {
                      month: '2-digit',
                      day:   '2-digit',
                      hour:  '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize:   9,
                    color:      'var(--t-muted)',
                  }}>
                    {repo.nodeCount.toLocaleString()} nodes · {repo.edgeCount.toLocaleString()} edges
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => handleReanalyze(repo)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize:   10,
                    }}
                  >
                    Analyze
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<EyeOutlined />}
                    onClick={() => handleViewGraph(repo)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize:   10,
                    }}
                  >
                    View
                  </Button>
                  <Popconfirm
                    title="Delete Repository"
                    description="Are you sure you want to delete this repository?"
                    onConfirm={() => handleDelete(repo.graphId)}
                    okText="Delete"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize:   10,
                      }}
                    />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Repository Modal ──────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
          setResult(null)
          setError(null)
        }}
        footer={null}
        width={560}
        styles={{
          body: {
            background: 'var(--s-raised)',
          },
          header: {
            background:   'var(--s-float)',
            borderBottom: '1px solid var(--b-faint)',
          },
        }}
        title={
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      11,
            color:         'var(--t-secondary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            ⬡ Add Repository
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
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

          <Form.Item
            name="repoName"
            label="REPO NAME (optional)"
            style={{ marginBottom: 16 }}
          >
            <Input
              placeholder="auto-detect from path"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Form.Item>

          <Form.Item
            name="languages"
            label="LANGUAGES (optional)"
            style={{ marginBottom: 24 }}
          >
            <Select
              mode="multiple"
              placeholder="auto-detect all languages"
              options={LANGS.map(l => ({ value: l, label: l }))}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Form.Item>

          {/* Toggles */}
          <div style={{
            padding:       '16px',
            marginBottom:  20,
            background:    'var(--s-float)',
            borderRadius:  'var(--radius-s)',
            border:        '1px solid var(--b-faint)',
            display:       'flex',
            flexDirection: 'column',
            gap:           16,
          }}>
            <Form.Item name="enableAi" valuePropName="checked" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Switch />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize:   13,
                      color:      'var(--t-primary)',
                      fontFamily: 'var(--font-ui)',
                      fontWeight: 500,
                    }}>
                      AI Semantic Analysis
                    </span>
                    <span style={{
                      fontSize:      9,
                      fontFamily:    'var(--font-mono)',
                      letterSpacing: '0.08em',
                      padding:       '1px 6px',
                      borderRadius:  2,
                      background:    'rgba(176,142,255,0.12)',
                      color:         'rgb(176,142,255)',
                      border:        '1px solid rgba(176,142,255,0.3)',
                    }}>
                      OPTIONAL
                    </span>
                  </div>
                  <div style={{
                    fontSize:   11,
                    color:      'var(--t-muted)',
                    fontFamily: 'var(--font-mono)',
                    marginTop:  2,
                  }}>
                    Requires ANTHROPIC_API_KEY
                  </div>
                </div>
              </div>
            </Form.Item>

            <Form.Item name="enableRag" valuePropName="checked" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Switch />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize:   13,
                      color:      'var(--t-primary)',
                      fontFamily: 'var(--font-ui)',
                      fontWeight: 500,
                    }}>
                      Vector Retrieval (RAG)
                    </span>
                    <span style={{
                      fontSize:      9,
                      fontFamily:    'var(--font-mono)',
                      letterSpacing: '0.08em',
                      padding:       '1px 6px',
                      borderRadius:  2,
                      background:    'rgba(255,193,69,0.12)',
                      color:         'rgb(255,193,69)',
                      border:        '1px solid rgba(255,193,69,0.3)',
                    }}>
                      OPTIONAL
                    </span>
                  </div>
                  <div style={{
                    fontSize:   11,
                    color:      'var(--t-muted)',
                    fontFamily: 'var(--font-mono)',
                    marginTop:  2,
                  }}>
                    Requires ChromaDB
                  </div>
                </div>
              </div>
            </Form.Item>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={analyzing}
            size="large"
            block
            style={{
              height:        44,
              fontSize:      13,
              fontFamily:    'var(--font-mono)',
              letterSpacing: '0.08em',
            }}
          >
            {analyzing ? 'ANALYZING...' : '⚡ RUN ANALYSIS'}
          </Button>

          {analyzing && (
            <div style={{ marginTop: 20 }}>
              <Progress percent={99} status="active" showInfo={false} />
              <div style={{
                marginTop:     6,
                fontSize:      11,
                fontFamily:    'var(--font-mono)',
                color:         'var(--t-muted)',
                letterSpacing: '0.06em',
              }}>
                parsing AST → building graph → computing metrics...
              </div>
            </div>
          )}

          {error && (
            <Alert
              type="error"
              message="Analysis Failed"
              description={
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {error}
                </span>
              }
              showIcon
              closable
              onClose={() => setError(null)}
              style={{ marginTop: 16 }}
            />
          )}

          {result && (
            <Alert
              type="success"
              message="Analysis Complete"
              description={
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  <div>Graph ID: {result.graphId}</div>
                  <div>Nodes: {result.nodeCount.toLocaleString()} · Edges: {result.edgeCount.toLocaleString()}</div>
                  <div>Duration: {result.duration.toFixed(2)}s</div>
                </div>
              }
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default Repository
