import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Form, Input, Button, Select, Alert, Popconfirm, Tag, Upload, message, Progress, Timeline } from 'antd'
import { PlusOutlined, ReloadOutlined, EyeOutlined, DeleteOutlined, GithubOutlined, FolderOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { repoApi } from '../../api/repoApi'
import { graphEndpoints } from '../../core/api/endpoints/graph'
import { useAnalysisStream } from '../../core/hooks/useAnalysisStream'
import { useRepoStore } from '../../store/repoStore'
import { useGraphStore } from '../../store/graphStore'
import type { AnalyzeRepoResponse, RepoInfo } from '../../types/api'

type SourceMode = 'local' | 'git' | 'zip'

const LANGS = ['python', 'typescript', 'javascript', 'java', 'go', 'rust', 'cpp', 'csharp']

// ─── Real-time Progress Display (SSE-driven) ──────────────────────────────────

const RealTimeProgress: React.FC<{
  currentStep: any
  completedSteps: any[]
  finalResult: any
  isConnected: boolean
}> = ({ currentStep, completedSteps, finalResult, isConnected }) => {
  const [startTime] = useState(Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!currentStep && !finalResult) return
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [currentStep, finalResult, startTime])

  const total = currentStep?.total ?? 13
  const step = currentStep?.step ?? 0
  const progress = total > 0 ? Math.round((step / total) * 100) : 0

  return (
    <div style={{ marginTop: 20 }}>
      {/* Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: isConnected ? '#00f084' : '#ffc145',
          boxShadow: isConnected ? '0 0 8px #00f084' : 'none',
        }} />
        <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.08em' }}>
          {isConnected ? '实时连接' : '连接中...'}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 9, color: 'var(--t-muted)' }}>
          {elapsed}s
        </span>
      </div>

      {/* Progress bar */}
      <Progress
        percent={progress}
        strokeColor={{
          '0%': '#00d4ff',
          '100%': '#00f084',
        }}
        trailColor="var(--s-float)"
        style={{ marginBottom: 16 }}
      />

      {/* Current step */}
      {currentStep && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(0,212,255,0.06)',
          border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: 4,
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#00d4ff',
              animation: 'pulse 1s ease-in-out infinite',
            }} />
            <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11, color: '#00d4ff', letterSpacing: '0.08em' }}>
              步骤 {step}/{total}: {currentStep.stage || '处理中'}
            </span>
          </div>
          {currentStep.message && (
            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: 'var(--t-secondary)', paddingLeft: 16 }}>
              {currentStep.message}
            </div>
          )}
        </div>
      )}

      {/* Completed steps timeline */}
      {completedSteps.length > 0 && (
        <div style={{
          maxHeight: 200,
          overflowY: 'auto',
          padding: '12px 16px',
          background: 'var(--s-float)',
          border: '1px solid var(--b-faint)',
          borderRadius: 4,
        }}>
          <Timeline
            items={completedSteps.map((step, i) => ({
              key: i,
              color: '#00f084',
              children: (
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}>
                  <span style={{ color: 'var(--t-secondary)' }}>{step.stage}</span>
                  {step.message && (
                    <span style={{ color: 'var(--t-muted)', marginLeft: 8 }}>— {step.message}</span>
                  )}
                </div>
              ),
            }))}
          />
        </div>
      )}

      {/* Final result */}
      {finalResult && finalResult.status === 'completed' && (
        <div style={{
          marginTop: 16,
          padding: '14px 16px',
          background: 'rgba(0,240,132,0.06)',
          border: '1px solid rgba(0,240,132,0.2)',
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
              { label: '图谱 ID', value: finalResult.graph_id || '—' },
              { label: '耗时', value: `${finalResult.elapsed_seconds?.toFixed(2) ?? elapsed}s` },
              { label: '节点数', value: (finalResult.node_count ?? 0).toLocaleString() },
              { label: '边数', value: (finalResult.edge_count ?? 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#2a5a3a', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12, color: '#00f084', fontWeight: 600 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error result */}
      {finalResult && finalResult.status === 'failed' && (
        <Alert
          type="error"
          message="分析失败"
          description={<span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>{finalResult.error || '未知错误'}</span>}
          showIcon
          style={{ marginTop: 16 }}
        />
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
  const [taskId, setTaskId]           = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [zipFileList, setZipFileList] = useState<UploadFile[]>([])

  // SSE stream for async analysis
  const { currentStep, completedSteps, finalResult, isConnected } = useAnalysisStream(taskId)

  const handleCloseModal = () => {
    setModalOpen(false)
    form.resetFields()
    setTaskId(null)
    setError(null)
    setZipFileList([])
  }

  const onAnalyzeSuccess = (
    res: AnalyzeRepoResponse,
    opts: { languages?: string[]; repoPath?: string; branch?: string; sourceMode?: SourceMode }
  ) => {
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
    })
    setTimeout(handleCloseModal, 2500)
  }

  const handleSubmit = async (values: {
    repoPath?: string; gitUrl?: string; branch?: string; repoName?: string
    languages?: string[]
  }) => {
    setError(null)
    setTaskId(null)

    try {
      if (sourceMode === 'zip') {
        // ZIP upload remains synchronous
        const rawFile = zipFileList[0]?.originFileObj
        if (!rawFile) { message.error('请先选择 ZIP 文件'); return }
        const res = await repoApi.analyzeZip(rawFile, {
          repoName: values.repoName, languages: values.languages,
        })
        onAnalyzeSuccess(res, { languages: values.languages, repoPath: rawFile.name, sourceMode: 'zip' })
      } else {
        // Git/local path uses async analysis
        const repoPath = sourceMode === 'git' ? (values.gitUrl ?? '') : (values.repoPath ?? '')
        const response = await graphEndpoints.analyzeRepository({
          repo_path: repoPath,
          repo_name: values.repoName,
          languages: values.languages,
        })
        setTaskId(response.task_id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败')
    }
  }

  // Navigate to architecture page when analysis completes
  useEffect(() => {
    if (finalResult?.status === 'completed' && finalResult.graph_id) {
      const graphId = finalResult.graph_id
      const nodeCount = finalResult.node_count ?? 0
      const edgeCount = finalResult.edge_count ?? 0

      // Add to repo store
      addRepo({
        graphId,
        repoName: form.getFieldValue('repoName') || graphId,
        language: form.getFieldValue('languages') || [],
        createdAt: new Date().toISOString(),
        nodeCount,
        edgeCount,
        repoPath: sourceMode === 'git' ? form.getFieldValue('gitUrl') : form.getFieldValue('repoPath'),
        branch: form.getFieldValue('branch'),
        sourceMode,
      })

      // Set active graph and navigate
      setActiveGraphId(graphId)
      message.success('分析完成，正在跳转...')
      setTimeout(() => {
        navigate(`/architecture?graph_id=${graphId}`)
        handleCloseModal()
      }, 1500)
    }
  }, [finalResult, navigate, addRepo, setActiveGraphId, form, sourceMode])

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
          const response = await graphEndpoints.analyzeRepository({
            repo_path: repo.repoPath!,
            repo_name: repo.repoName,
            languages: repo.language,
          })
          message.info({ content: `任务已提交: ${response.task_id}`, key: 'reanalyze' })
          // Note: Could open a modal to track progress here
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
          分析流水线：13 步全自动分析（扫描 → 解析 → 模块检测 → 组件检测 → 依赖分析 → 调用图 → 事件分析 → 基础设施 → AI 分析 → 图谱构建 → 持久化 → 向量化）
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono'", fontSize: 9, color: '#2a4a5a', letterSpacing: '0.06em' }}>
          AnalysisPipeline v2
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

        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
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

          <Button
            type="primary"
            htmlType="submit"
            loading={!!taskId && !finalResult}
            size="large"
            block
            style={{ height: 44, fontSize: 13, fontFamily: "'IBM Plex Mono'", letterSpacing: '0.08em' }}
          >
            {taskId && !finalResult ? '分析中...' : '⚡ 开始分析'}
          </Button>

          {/* Real-time progress */}
          {taskId && (
            <RealTimeProgress
              currentStep={currentStep}
              completedSteps={completedSteps}
              finalResult={finalResult}
              isConnected={isConnected}
            />
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
        </Form>
      </Modal>
    </div>
  )
}

export default Repository
