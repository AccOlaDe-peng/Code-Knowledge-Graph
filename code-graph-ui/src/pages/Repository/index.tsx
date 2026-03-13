import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Form, Input, Button, Switch, Select, Alert, Popconfirm, Tag, Upload, message } from 'antd'
import { PlusOutlined, ReloadOutlined, EyeOutlined, DeleteOutlined, GithubOutlined, FolderOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { repoApi } from '../../api/repoApi'
import { useRepoStore } from '../../store/repoStore'
import { useGraphStore } from '../../store/graphStore'
import type { AnalyzeRepoResponse, RepoInfo } from '../../types/api'

type SourceMode = 'local' | 'git' | 'zip'

const LANGS = ['python', 'typescript', 'javascript', 'java', 'go', 'rust', 'cpp', 'csharp']

// ─── Pipeline Steps ───────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: 'scan',   label: 'SCAN REPO',    desc: '扫描文件 + Git 信息',      icon: '◎' },
  { key: 'parse',  label: 'PARSE CODE',   desc: 'AST 解析类/函数/调用',      icon: '⟨⟩' },
  { key: 'ai',     label: 'AI ANALYZE',   desc: 'LLM 逐文件分析',           icon: '◈' },
  { key: 'build',  label: 'BUILD GRAPH',  desc: '合并节点/边，去重',         icon: '⬡' },
  { key: 'export', label: 'EXPORT JSON',  desc: '写入 graph.json',          icon: '↗' },
]

type StepStatus = 'idle' | 'running' | 'done' | 'skipped'

// ─── Pipeline Progress Display ────────────────────────────────────────────────

const PipelineProgress: React.FC<{
  active: boolean
  enableAi: boolean
  done: boolean
}> = ({ active, enableAi, done }) => {
  const [stepIdx, setStepIdx]   = useState(-1)
  const [statuses, setStatuses] = useState<StepStatus[]>(PIPELINE_STEPS.map(() => 'idle'))
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) {
      setStepIdx(-1)
      setStatuses(PIPELINE_STEPS.map(() => 'idle'))
      return
    }
    // Simulate step-by-step progress
    const delays = [0, 800, 1800, enableAi ? 3500 : 2400, enableAi ? 5000 : 3200]
    delays.forEach((delay, i) => {
      timerRef.current = setTimeout(() => {
        setStepIdx(i)
        setStatuses((prev) => {
          const next = [...prev]
          if (i > 0) next[i - 1] = 'done'
          next[i] = 'running'
          if (!enableAi && i === 2) next[i] = 'skipped'
          return next
        })
      }, delay)
    })
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [active, enableAi])

  useEffect(() => {
    if (done) {
      setStatuses(PIPELINE_STEPS.map((_, i) => (!enableAi && i === 2) ? 'skipped' : 'done'))
      setStepIdx(PIPELINE_STEPS.length)
    }
  }, [done, enableAi])

  return (
    <div style={{ marginTop: 20 }}>
      {/* Step track */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 12 }}>
        {PIPELINE_STEPS.map((step, i) => {
          const status = statuses[i]
          const color  = status === 'done'    ? '#00f084' :
                         status === 'running' ? '#00d4ff' :
                         status === 'skipped' ? '#3a5a6a' :
                         '#1a2535'
          const isLast = i === PIPELINE_STEPS.length - 1
          return (
            <React.Fragment key={step.key}>
              <div style={{
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           4,
                flex:          1,
              }}>
                {/* Circle */}
                <div style={{
                  width:        28,
                  height:       28,
                  borderRadius: '50%',
                  border:       `2px solid ${color}`,
                  background:   status === 'running' ? `${color}18` : 'transparent',
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent: 'center',
                  fontSize:     12,
                  color,
                  boxShadow:    status === 'running' ? `0 0 12px ${color}66` : 'none',
                  transition:   'all 0.3s ease',
                  position:     'relative',
                }}>
                  {status === 'running' ? (
                    <div style={{
                      width:        8,
                      height:       8,
                      borderRadius: '50%',
                      background:   color,
                      animation:    'pulse 1s ease-in-out infinite',
                    }} />
                  ) : status === 'done' ? (
                    <span style={{ fontSize: 11 }}>✓</span>
                  ) : status === 'skipped' ? (
                    <span style={{ fontSize: 10 }}>—</span>
                  ) : (
                    <span style={{ fontSize: 10, opacity: 0.4 }}>{i + 1}</span>
                  )}
                </div>
                {/* Label */}
                <div style={{
                  fontFamily:    "'IBM Plex Mono', monospace",
                  fontSize:      8,
                  color,
                  letterSpacing: '0.1em',
                  textAlign:     'center',
                  whiteSpace:    'nowrap',
                  opacity:       status === 'idle' ? 0.3 : 1,
                }}>
                  {step.label}
                </div>
              </div>
              {/* Connector */}
              {!isLast && (
                <div style={{
                  height:     1.5,
                  flex:       0.4,
                  background: i < stepIdx
                    ? 'linear-gradient(90deg, #00f084, #00d4ff)'
                    : '#1a2535',
                  transition: 'background 0.4s ease',
                  marginBottom: 20,
                }} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Current step description */}
      {stepIdx >= 0 && stepIdx < PIPELINE_STEPS.length && (
        <div style={{
          fontFamily:    "'IBM Plex Mono', monospace",
          fontSize:      10,
          color:         '#00d4ff',
          letterSpacing: '0.08em',
          textAlign:     'center',
          opacity:       0.8,
        }}>
          {statuses[stepIdx] === 'running' && `▶ ${PIPELINE_STEPS[stepIdx].desc}...`}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.7); }
        }
      `}</style>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: 'completed' | 'pending' | 'analyzing' }> = ({ status }) => {
  const cfg = {
    completed: { label: '已完成', color: '#00f084', bg: 'rgba(0,240,132,0.08)',  border: 'rgba(0,240,132,0.2)' },
    pending:   { label: '等待中', color: '#ffc145', bg: 'rgba(255,193,69,0.08)', border: 'rgba(255,193,69,0.2)' },
    analyzing: { label: '分析中', color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',  border: 'rgba(0,212,255,0.2)' },
  }[status]
  return (
    <div style={{
      display:    'inline-flex',
      alignItems: 'center',
      gap:        5,
      padding:    '3px 9px',
      borderRadius: 2,
      background: cfg.bg,
      border:     `1px solid ${cfg.border}`,
    }}>
      <span style={{
        width: 4, height: 4, borderRadius: '50%',
        background: cfg.color,
        boxShadow:  status === 'analyzing' ? `0 0 6px ${cfg.color}` : 'none',
      }} />
      <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: cfg.color, letterSpacing: '0.08em' }}>
        {cfg.label}
      </span>
    </div>
  )
}

// ─── Repository Page ──────────────────────────────────────────────────────────

const Repository: React.FC = () => {
  const navigate    = useNavigate()
  const repos       = useRepoStore(s => s.repos ?? [])
  const addRepo     = useRepoStore(s => s.addRepo)
  const removeRepo  = useRepoStore(s => s.removeRepo)
  const { setActiveGraphId } = useGraphStore()

  const [modalOpen, setModalOpen]     = useState(false)
  const [sourceMode, setSourceMode]   = useState<SourceMode>('git')
  const [form]                        = Form.useForm()
  const [analyzing, setAnalyzing]     = useState(false)
  const [analysisDone, setAnalysisDone] = useState(false)
  const [result, setResult]           = useState<AnalyzeRepoResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [zipFileList, setZipFileList] = useState<UploadFile[]>([])
  const [enableAiState, setEnableAiState] = useState(false)

  const handleCloseModal = () => {
    setModalOpen(false)
    form.resetFields()
    setResult(null)
    setError(null)
    setZipFileList([])
    setAnalyzing(false)
    setAnalysisDone(false)
    setEnableAiState(false)
  }

  const onAnalyzeSuccess = (
    res: AnalyzeRepoResponse,
    opts: { languages?: string[]; repoPath?: string; branch?: string; sourceMode?: SourceMode; enableAi?: boolean; enableRag?: boolean }
  ) => {
    setAnalysisDone(true)
    setResult(res)
    addRepo({
      graphId:    res.graphId,
      repoName:   res.repoName,
      language:   opts.languages || [],
      createdAt:  new Date().toISOString(),
      nodeCount:  res.nodeCount,
      edgeCount:  res.edgeCount,
      repoPath:   opts.repoPath,
      branch:     opts.branch,
      sourceMode: opts.sourceMode,
      enableAi:   opts.enableAi,
      enableRag:  opts.enableRag,
    })
    setTimeout(handleCloseModal, 2500)
  }

  const handleSubmit = async (values: {
    repoPath?: string; gitUrl?: string; branch?: string; repoName?: string
    languages?: string[]; enableAi?: boolean; enableRag?: boolean
  }) => {
    setAnalyzing(true)
    setAnalysisDone(false)
    setError(null)
    setResult(null)
    setEnableAiState(values.enableAi ?? false)

    try {
      if (sourceMode === 'zip') {
        const rawFile = zipFileList[0]?.originFileObj
        if (!rawFile) { message.error('请先选择 ZIP 文件'); setAnalyzing(false); return }
        const res = await repoApi.analyzeZip(rawFile, {
          repoName: values.repoName, languages: values.languages,
          enableAi: values.enableAi ?? false, enableRag: values.enableRag ?? false,
        })
        onAnalyzeSuccess(res, { languages: values.languages, repoPath: rawFile.name, sourceMode: 'zip', enableAi: values.enableAi, enableRag: values.enableRag })
      } else {
        const repoPath = sourceMode === 'git' ? (values.gitUrl ?? '') : (values.repoPath ?? '')
        const res = await repoApi.analyzeRepository({
          repoPath, repoName: values.repoName, branch: values.branch,
          languages: values.languages, enableAi: values.enableAi ?? false, enableRag: values.enableRag ?? false,
        })
        onAnalyzeSuccess(res, { languages: values.languages, repoPath, branch: values.branch, sourceMode, enableAi: values.enableAi, enableRag: values.enableRag })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败')
      setAnalyzing(false)
      setAnalysisDone(false)
    }
  }

  const handleReanalyze = async (repo: RepoInfo) => {
    if (!repo.repoPath) {
      Modal.warning({ title: '无法重新分析', content: `仓库 "${repo.repoName}" 缺少原始路径信息。` })
      return
    }
    if (repo.sourceMode === 'zip') {
      Modal.warning({ title: '无法重新分析', content: 'ZIP 上传的仓库无法重新分析，请重新上传 ZIP 文件。' })
      return
    }
    Modal.confirm({
      title: '重新分析仓库',
      content: `确定要重新分析 "${repo.repoName}" 吗？这将覆盖现有图谱数据。`,
      okText: '确定', cancelText: '取消',
      onOk: async () => {
        try {
          message.loading({ content: '正在重新分析...', key: 'reanalyze', duration: 0 })
          const res = await repoApi.analyzeRepository({
            repoPath: repo.repoPath!, repoName: repo.repoName, branch: repo.branch,
            languages: repo.language, enableAi: repo.enableAi ?? false, enableRag: repo.enableRag ?? false,
          })
          removeRepo(repo.graphId)
          addRepo({ ...repo, graphId: res.graphId, nodeCount: res.nodeCount, edgeCount: res.edgeCount, createdAt: new Date().toISOString() })
          message.success({ content: '重新分析完成', key: 'reanalyze' })
        } catch (e) {
          message.error({ content: e instanceof Error ? e.message : '重新分析失败', key: 'reanalyze' })
        }
      },
    })
  }

  const handleViewGraph = (repo: RepoInfo) => {
    setActiveGraphId(repo.graphId)
    navigate('/architecture')
  }

  const handleDelete = async (graphId: string) => {
    if (!graphId) { message.error('仓库 ID 缺失，无法删除'); return }
    try {
      await repoApi.deleteRepository(graphId)
      removeRepo(graphId)
      message.success('仓库已删除')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div>
      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono'", color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 4 }}>
            系统 / 仓库
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t-primary)', fontFamily: "'Syne', sans-serif", letterSpacing: '-0.01em' }}>
            仓库管理
          </h2>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ height: 40, fontSize: 13, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          添加仓库
        </Button>
      </div>

      {/* ── Pipeline info banner ──────────────────────────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        padding:      '10px 16px',
        marginBottom: 16,
        background:   'rgba(0,212,255,0.04)',
        border:       '1px solid rgba(0,212,255,0.12)',
        borderRadius: 4,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d4ff', flexShrink: 0 }} />
        <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: '#3a6a7a', letterSpacing: '0.06em' }}>
          分析流水线：
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {PIPELINE_STEPS.map((step, i) => (
            <React.Fragment key={step.key}>
              <span style={{
                fontFamily:    "'IBM Plex Mono'",
                fontSize:      9,
                color:         '#00d4ff88',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {step.icon} {step.label}
              </span>
              {i < PIPELINE_STEPS.length - 1 && (
                <span style={{ color: '#1a2535', fontSize: 10 }}>→</span>
              )}
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#2a4a5a', letterSpacing: '0.06em' }}>
          GraphPipeline v2
        </div>
      </div>

      {/* ── Repository table ──────────────────────────────────────────────── */}
      <div style={{ background: 'var(--s-raised)', border: '1px solid var(--b-faint)', borderRadius: 'var(--radius-m)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--b-faint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--t-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            仓库列表
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--t-muted)' }}>
            共 {repos.length} 个
          </div>
        </div>

        {/* Empty state */}
        {repos.length === 0 && (
          <div style={{ padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, opacity: 0.06, marginBottom: 16 }}>⬡</div>
            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--t-muted)', letterSpacing: '0.1em', marginBottom: 12 }}>
              暂无仓库
            </div>
            <Button type="link" onClick={() => setModalOpen(true)} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--t-cyan)' }}>
              添加第一个仓库 →
            </Button>
          </div>
        )}

        {/* Rows */}
        {repos.length > 0 && (
          <div>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1.5fr', gap: 16, padding: '12px 20px', background: 'var(--s-float)', borderBottom: '1px solid var(--b-faint)' }}>
              {['名称', '分支', '状态', '最近分析', '操作'].map(h => (
                <div key={h} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.12em' }}>{h}</div>
              ))}
            </div>

            {repos.map((repo, i) => (
              <div
                key={repo.graphId || `repo-${i}`}
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
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 13, fontWeight: 500, color: 'var(--t-cyan)', marginBottom: 4 }}>
                    {repo.repoName}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(repo.language ?? []).slice(0, 3).map(lang => (
                      <Tag key={lang} style={{ margin: 0, fontSize: 9, fontFamily: "'IBM Plex Mono'", background: 'rgba(176,142,255,0.08)', border: '1px solid rgba(176,142,255,0.2)', color: '#b08eff', letterSpacing: '0.04em' }}>
                        {lang}
                      </Tag>
                    ))}
                    {(repo.language ?? []).length > 3 && (
                      <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono'", color: 'var(--t-muted)' }}>
                        +{(repo.language ?? []).length - 3}
                      </span>
                    )}
                  </div>
                </div>

                {/* Branch */}
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12, color: 'var(--t-secondary)' }}>
                  {repo.gitCommit ? (
                    <div>
                      <div style={{ marginBottom: 2 }}>主分支</div>
                      <div style={{ fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.02em' }}>{repo.gitCommit.slice(0, 7)}</div>
                    </div>
                  ) : <span style={{ color: 'var(--t-muted)' }}>—</span>}
                </div>

                {/* Status */}
                <div><StatusBadge status={repo.graphId ? 'completed' : 'pending'} /></div>

                {/* Last analysis */}
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--t-secondary)', marginBottom: 2 }}>
                    {new Date(repo.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: 'var(--t-muted)' }}>
                    {repo.nodeCount.toLocaleString()} 节点 · {repo.edgeCount.toLocaleString()} 边
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => handleReanalyze(repo)} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}>重新分析</Button>
                  <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => handleViewGraph(repo)} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}>查看</Button>
                  <Popconfirm title="删除仓库" description="确定要删除此仓库吗？" onConfirm={() => handleDelete(repo.graphId)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                    <Button size="small" danger icon={<DeleteOutlined />} style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }} />
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
        width={600}
        styles={{
          body:   { background: 'var(--s-raised)' },
          header: { background: 'var(--s-float)', borderBottom: '1px solid var(--b-faint)' },
        }}
        title={
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: 'var(--t-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            ⬡ 添加仓库
          </div>
        }
      >
        {/* Source mode selector */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, padding: 4, background: 'var(--s-float)', borderRadius: 'var(--radius-s)', border: '1px solid var(--b-faint)' }}>
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
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '8px 0', border: 'none', borderRadius: 'calc(var(--radius-s) - 2px)',
                cursor: 'pointer', fontFamily: "'IBM Plex Mono'", fontSize: 12, transition: 'all 0.15s',
                background: sourceMode === item.key ? 'var(--a-cyan)' : 'transparent',
                color:      sourceMode === item.key ? '#000' : 'var(--t-secondary)',
                fontWeight: sourceMode === item.key ? 600 : 400,
              }}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>

        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false} initialValues={{ enableAi: false, enableRag: false }}>
          {sourceMode === 'git' && (<>
            <Form.Item name="gitUrl" label="Git 仓库地址" rules={[{ required: true, message: 'Git URL 不能为空' }]} style={{ marginBottom: 16 }}>
              <Input placeholder="git@github.com:org/repo.git 或 https://github.com/org/repo.git" style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }} />
            </Form.Item>
            <Form.Item name="branch" label="分支（可选，默认 HEAD）" style={{ marginBottom: 16 }}>
              <Input placeholder="main / master / feature/xxx" style={{ fontFamily: "'IBM Plex Mono'" }} />
            </Form.Item>
          </>)}

          {sourceMode === 'local' && (
            <Form.Item name="repoPath" label="本地仓库路径" rules={[{ required: true, message: '路径不能为空' }]} style={{ marginBottom: 16 }}>
              <Input placeholder="/path/to/your/repo" style={{ fontFamily: "'IBM Plex Mono'" }} />
            </Form.Item>
          )}

          {sourceMode === 'zip' && (
            <Form.Item label="ZIP 压缩包" style={{ marginBottom: 16 }}>
              <Upload accept=".zip" maxCount={1} fileList={zipFileList} beforeUpload={() => false} onChange={({ fileList }) => setZipFileList(fileList)}>
                <Button icon={<UploadOutlined />} style={{ fontFamily: "'IBM Plex Mono'" }}>选择 ZIP 文件</Button>
              </Upload>
            </Form.Item>
          )}

          <Form.Item name="repoName" label="仓库名称（可选）" style={{ marginBottom: 16 }}>
            <Input placeholder="自动从 URL / 路径 / 文件名检测" style={{ fontFamily: "'IBM Plex Mono'" }} />
          </Form.Item>

          <Form.Item name="languages" label="编程语言（可选）" style={{ marginBottom: 20 }}>
            <Select mode="multiple" placeholder="自动检测所有语言" options={LANGS.map(l => ({ value: l, label: l }))} style={{ fontFamily: "'IBM Plex Mono'" }} />
          </Form.Item>

          {/* Toggles */}
          <div style={{ padding: '16px', marginBottom: 20, background: 'var(--s-float)', borderRadius: 'var(--radius-s)', border: '1px solid var(--b-faint)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Form.Item name="enableAi" valuePropName="checked" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Switch onChange={(checked) => form.setFieldsValue({ enableAi: checked })} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--t-primary)', fontFamily: "'Syne', sans-serif", fontWeight: 500 }}>AI 语义分析</span>
                    <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 2, background: 'rgba(176,142,255,0.12)', color: 'rgb(176,142,255)', border: '1px solid rgba(176,142,255,0.3)' }}>可选</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: "'IBM Plex Mono'", marginTop: 2 }}>
                    LLM 逐文件分析 · 需要 ANTHROPIC_API_KEY
                  </div>
                </div>
              </div>
            </Form.Item>

            <Form.Item name="enableRag" valuePropName="checked" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Switch onChange={(checked) => form.setFieldsValue({ enableRag: checked })} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--t-primary)', fontFamily: "'Syne', sans-serif", fontWeight: 500 }}>向量检索（RAG）</span>
                    <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 2, background: 'rgba(255,193,69,0.12)', color: 'rgb(255,193,69)', border: '1px solid rgba(255,193,69,0.3)' }}>可选</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: "'IBM Plex Mono'", marginTop: 2 }}>
                    向量化索引 · 需要 ChromaDB
                  </div>
                </div>
              </div>
            </Form.Item>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={analyzing && !analysisDone}
            size="large"
            block
            style={{ height: 44, fontSize: 13, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.08em' }}
          >
            {analyzing && !analysisDone ? '分析中...' : '⚡ 开始分析'}
          </Button>

          {/* Pipeline progress */}
          {analyzing && (
            <PipelineProgress active={analyzing} enableAi={enableAiState} done={analysisDone} />
          )}

          {error && (
            <Alert
              type="error"
              message="分析失败"
              description={<span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>{error}</span>}
              showIcon closable onClose={() => setError(null)}
              style={{ marginTop: 16 }}
            />
          )}

          {result && analysisDone && (
            <div style={{
              marginTop:    16,
              padding:      '14px 16px',
              background:   'rgba(0,240,132,0.06)',
              border:       '1px solid rgba(0,240,132,0.2)',
              borderRadius: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f084', boxShadow: '0 0 8px #00f084' }} />
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: '#00f084', letterSpacing: '0.08em' }}>
                  分析完成
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: '图谱 ID',  value: result.graphId },
                  { label: '耗时',     value: `${result.duration?.toFixed(2) ?? '—'}s` },
                  { label: '节点数',   value: result.nodeCount.toLocaleString() },
                  { label: '边数',     value: result.edgeCount.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#2a5a3a', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12, color: '#00f084', fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default Repository
