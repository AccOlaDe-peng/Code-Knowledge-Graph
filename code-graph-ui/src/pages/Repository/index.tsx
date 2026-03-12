import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Form, Input, Button, Switch, Select, Alert, Progress, Popconfirm, Tag, Upload, message } from 'antd'
import { PlusOutlined, ReloadOutlined, EyeOutlined, DeleteOutlined, GithubOutlined, FolderOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { repoApi } from '../../api/repoApi'
import { useRepoStore } from '../../store/repoStore'
import { useGraphStore } from '../../store/graphStore'
import type { AnalyzeRepoResponse, RepoInfo } from '../../types/api'

type SourceMode = 'local' | 'git' | 'zip'

const LANGS = ['python', 'typescript', 'javascript', 'java', 'go', 'rust', 'cpp', 'csharp']

// ─── Status Badge ─────────────────────────────────────────────────────────────

type StatusBadgeProps = { status: 'completed' | 'pending' | 'analyzing' }

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = {
    completed: { label: '已完成', color: '#00f084', bg: 'rgba(0,240,132,0.1)', border: 'rgba(0,240,132,0.3)' },
    pending:   { label: '等待中', color: '#ffc145', bg: 'rgba(255,193,69,0.1)', border: 'rgba(255,193,69,0.3)' },
    analyzing: { label: '分析中', color: '#00d4ff', bg: 'rgba(0,212,255,0.1)', border: 'rgba(0,212,255,0.3)' },
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
  const repos = useRepoStore(s => s.repos ?? [])
  const addRepo = useRepoStore(s => s.addRepo)
  const removeRepo = useRepoStore(s => s.removeRepo)
  const { setActiveGraphId } = useGraphStore()

  const [modalOpen, setModalOpen] = useState(false)
  const [sourceMode, setSourceMode] = useState<SourceMode>('git')
  const [form] = Form.useForm()
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeRepoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zipFileList, setZipFileList] = useState<UploadFile[]>([])

  const handleCloseModal = () => {
    setModalOpen(false)
    form.resetFields()
    setResult(null)
    setError(null)
    setZipFileList([])
  }

  const onAnalyzeSuccess = (res: AnalyzeRepoResponse, languages?: string[]) => {
    setResult(res)
    addRepo({
      graphId:   res.graphId,
      repoName:  res.repoName,
      language:  languages || [],
      createdAt: new Date().toISOString(),
      nodeCount: res.nodeCount,
      edgeCount: res.edgeCount,
    })
    setTimeout(handleCloseModal, 2000)
  }

  // ── Handle add repository ─────────────────────────────────────────────────

  const handleSubmit = async (values: {
    repoPath?: string
    gitUrl?: string
    branch?: string
    repoName?: string
    languages?: string[]
    enableAi?: boolean
    enableRag?: boolean
  }) => {
    setAnalyzing(true)
    setError(null)
    setResult(null)

    try {
      if (sourceMode === 'zip') {
        const rawFile = zipFileList[0]?.originFileObj
        if (!rawFile) { message.error('请先选择 ZIP 文件'); return }
        const res = await repoApi.analyzeZip(rawFile, {
          repoName:  values.repoName,
          languages: values.languages,
          enableAi:  values.enableAi ?? false,
          enableRag: values.enableRag ?? false,
        })
        onAnalyzeSuccess(res, values.languages)
      } else {
        const res = await repoApi.analyzeRepository({
          repoPath:  sourceMode === 'git' ? (values.gitUrl ?? '') : (values.repoPath ?? ''),
          repoName:  values.repoName,
          branch:    values.branch,
          languages: values.languages,
          enableAi:  values.enableAi ?? false,
          enableRag: values.enableRag ?? false,
        })
        onAnalyzeSuccess(res, values.languages)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Handle re-analyze ─────────────────────────────────────────────────────

  const handleReanalyze = async (repo: RepoInfo) => {
    // In a real app, you'd need to store the original repoPath
    // For now, just show a message
    Modal.info({
      title: '重新分析仓库',
      content: `将重新触发对 "${repo.repoName}" 的分析。此功能需要存储原始仓库路径。`,
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
            系统 / 仓库
          </div>
          <h2 style={{
            margin:        0,
            fontSize:      22,
            fontWeight:    700,
            color:         'var(--t-primary)',
            fontFamily:    'var(--font-ui)',
            letterSpacing: '-0.01em',
          }}>
            仓库管理
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
          添加仓库
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
            仓库列表
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   10,
            color:      'var(--t-muted)',
          }}>
            共 {repos.length} 个
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
              暂无仓库
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
              添加第一个仓库 →
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
              {['名称', '分支', '状态', '最近分析', '操作'].map(h => (
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
                    {(repo.language ?? []).slice(0, 3).map(lang => (
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
                    {(repo.language ?? []).length > 3 && (
                      <span style={{
                        fontSize:   9,
                        fontFamily: 'var(--font-mono)',
                        color:      'var(--t-muted)',
                      }}>
                        +{(repo.language ?? []).length - 3}
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
                      <div style={{ marginBottom: 2 }}>主分支</div>
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
                    {repo.nodeCount.toLocaleString()} 节点 · {repo.edgeCount.toLocaleString()} 边
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
                    重新分析
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
                    查看
                  </Button>
                  <Popconfirm
                    title="删除仓库"
                    description="确定要删除此仓库吗？"
                    onConfirm={() => handleDelete(repo.graphId)}
                    okText="删除"
                    cancelText="取消"
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
        onCancel={handleCloseModal}
        footer={null}
        width={580}
        styles={{
          body:   { background: 'var(--s-raised)' },
          header: { background: 'var(--s-float)', borderBottom: '1px solid var(--b-faint)' },
        }}
        title={
          <div style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      11,
            color:         'var(--t-secondary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            ⬡ 添加仓库
          </div>
        }
      >
        {/* ── Source mode selector ── */}
        <div style={{
          display:       'flex',
          gap:           4,
          marginBottom:  20,
          padding:       4,
          background:    'var(--s-float)',
          borderRadius:  'var(--radius-s)',
          border:        '1px solid var(--b-faint)',
        }}>
          {([
            { key: 'git',   label: 'Git 仓库',  icon: <GithubOutlined /> },
            { key: 'local', label: '本地路径',   icon: <FolderOutlined /> },
            { key: 'zip',   label: 'ZIP 上传',   icon: <UploadOutlined /> },
          ] as { key: SourceMode; label: string; icon: React.ReactNode }[]).map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => { setSourceMode(item.key); form.resetFields() }}
              style={{
                flex:          1,
                display:       'flex',
                alignItems:    'center',
                justifyContent:'center',
                gap:           6,
                padding:       '8px 0',
                border:        'none',
                borderRadius:  'calc(var(--radius-s) - 2px)',
                cursor:        'pointer',
                fontFamily:    'var(--font-mono)',
                fontSize:      12,
                transition:    'all 0.15s',
                background:    sourceMode === item.key ? 'var(--a-cyan)' : 'transparent',
                color:         sourceMode === item.key ? '#000' : 'var(--t-secondary)',
                fontWeight:    sourceMode === item.key ? 600 : 400,
              }}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          {/* ── Git URL mode ── */}
          {sourceMode === 'git' && (<>
            <Form.Item
              name="gitUrl"
              label="Git 仓库地址"
              rules={[{ required: true, message: 'Git URL 不能为空' }]}
              style={{ marginBottom: 16 }}
            >
              <Input
                placeholder="git@github.com:org/repo.git 或 https://github.com/org/repo.git"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </Form.Item>
            <Form.Item
              name="branch"
              label="分支（可选，默认 HEAD）"
              style={{ marginBottom: 16 }}
            >
              <Input
                placeholder="main / master / feature/xxx"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </Form.Item>
          </>)}

          {/* ── Local path mode ── */}
          {sourceMode === 'local' && (
            <Form.Item
              name="repoPath"
              label="本地仓库路径"
              rules={[{ required: true, message: '路径不能为空' }]}
              style={{ marginBottom: 16 }}
            >
              <Input
                placeholder="/path/to/your/repo"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </Form.Item>
          )}

          {/* ── ZIP upload mode ── */}
          {sourceMode === 'zip' && (
            <Form.Item label="ZIP 压缩包" style={{ marginBottom: 16 }}>
              <Upload
                accept=".zip"
                maxCount={1}
                fileList={zipFileList}
                beforeUpload={() => false}
                onChange={({ fileList }) => setZipFileList(fileList)}
              >
                <Button icon={<UploadOutlined />} style={{ fontFamily: 'var(--font-mono)' }}>
                  选择 ZIP 文件
                </Button>
              </Upload>
            </Form.Item>
          )}

          <Form.Item
            name="repoName"
            label="仓库名称（可选）"
            style={{ marginBottom: 16 }}
          >
            <Input
              placeholder="自动从 URL / 路径 / 文件名检测"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Form.Item>

          <Form.Item
            name="languages"
            label="编程语言（可选）"
            style={{ marginBottom: 24 }}
          >
            <Select
              mode="multiple"
              placeholder="自动检测所有语言"
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
                      AI 语义分析
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
                      可选
                    </span>
                  </div>
                  <div style={{
                    fontSize:   11,
                    color:      'var(--t-muted)',
                    fontFamily: 'var(--font-mono)',
                    marginTop:  2,
                  }}>
                    需要 ANTHROPIC_API_KEY
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
                      向量检索（RAG）
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
                      可选
                    </span>
                  </div>
                  <div style={{
                    fontSize:   11,
                    color:      'var(--t-muted)',
                    fontFamily: 'var(--font-mono)',
                    marginTop:  2,
                  }}>
                    需要 ChromaDB
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
            {analyzing ? '分析中...' : '⚡ 开始分析'}
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
                解析 AST → 构建图谱 → 计算指标...
              </div>
            </div>
          )}

          {error && (
            <Alert
              type="error"
              message="分析失败"
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
              message="分析完成"
              description={
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  <div>图谱 ID：{result.graphId}</div>
                  <div>节点：{result.nodeCount.toLocaleString()} · 边：{result.edgeCount.toLocaleString()}</div>
                  <div>耗时：{result.duration.toFixed(2)}s</div>
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
