import React from 'react'
import { Button } from 'antd'

// ─── Types ────────────────────────────────────────────────────────────────────

type EmptyStateProps = {
  icon: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  size?: 'small' | 'medium' | 'large'
}

// ─── Empty State Variants ─────────────────────────────────────────────────────

const SIZE_CONFIG = {
  small: { iconSize: 40, padding: '32px 24px' },
  medium: { iconSize: 56, padding: '48px 32px' },
  large: { iconSize: 72, padding: '72px 48px' },
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  size = 'medium',
}) => {
  const config = SIZE_CONFIG[size]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: config.padding,
        textAlign: 'center',
        animation: 'fadeSlideIn 0.4s var(--ease-out) forwards',
      }}
    >
      {/* Animated icon container */}
      <div
        style={{
          width: config.iconSize + 24,
          height: config.iconSize + 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
          position: 'relative',
        }}
      >
        {/* Glow background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)',
            borderRadius: '50%',
            animation: 'pulseGlow 3s ease-in-out infinite',
          }}
        />
        {/* Icon */}
        <div
          style={{
            fontSize: config.iconSize,
            color: 'var(--t-cyan)',
            opacity: 0.7,
            animation: 'float 3s ease-in-out infinite',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--t-secondary)',
          marginBottom: description ? 8 : 0,
        }}
      >
        {title}
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--t-muted)',
            maxWidth: 300,
            lineHeight: 1.6,
            marginBottom: action ? 20 : 0,
          }}
        >
          {description}
        </div>
      )}

      {/* Action button */}
      {action && (
        <Button
          type="primary"
          onClick={action.onClick}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 14,
          }}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

// ─── Preset Empty States ───────────────────────────────────────────────────────

import {
  IconArchitecture,
  IconRepository,
  IconQuery,
  IconConnect,
} from '../Icons'

export const EmptyGraph: React.FC<{ onAddNode?: () => void }> = ({ onAddNode }) => (
  <EmptyState
    icon={<IconArchitecture size={1} color="currentColor" />}
    title="暂无图谱数据"
    description="选择一个已分析的仓库，或添加新仓库开始分析"
    action={onAddNode ? { label: '添加仓库', onClick: onAddNode } : undefined}
    size="large"
  />
)

export const EmptyRepository: React.FC<{ onAdd?: () => void }> = ({ onAdd }) => (
  <EmptyState
    icon={<IconRepository size={1} color="currentColor" />}
    title="暂无仓库"
    description="添加第一个代码仓库开始构建知识图谱"
    action={onAdd ? { label: '添加仓库', onClick: onAdd } : undefined}
    size="medium"
  />
)

export const EmptySearchResults: React.FC<{ query: string }> = ({ query }) => (
  <EmptyState
    icon={<IconQuery size={1} color="currentColor" />}
    title="未找到匹配结果"
    description={`未找到与 "${query}" 相关的节点`}
    size="small"
  />
)

export const EmptyConnections: React.FC = () => (
  <EmptyState
    icon={<IconConnect size={1} color="currentColor" />}
    title="暂无连接"
    description="该节点暂无依赖或被引用关系"
    size="small"
  />
)

export const EmptyMessages: React.FC = () => (
  <EmptyState
    icon={<IconQuery size={1} color="currentColor" />}
    title="开始对话"
    description="输入问题开始 AI 代码问答"
    size="medium"
  />
)

export const EmptyAnalysis: React.FC<{ onStart?: () => void }> = ({ onStart }) => (
  <EmptyState
    icon={<IconArchitecture size={1} color="currentColor" />}
    title="暂无分析记录"
    description="开始分析您的第一个代码仓库"
    action={onStart ? { label: '开始分析', onClick: onStart } : undefined}
    size="medium"
  />
)

export default EmptyState
