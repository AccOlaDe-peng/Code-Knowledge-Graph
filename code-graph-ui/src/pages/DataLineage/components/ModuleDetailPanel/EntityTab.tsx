/**
 * EntityTab - 实体 Tab 组件。
 *
 * 列表展示模块的所有数据实体：
 * - 实体名称和表名
 * - 字段列表（可折叠）
 * - 描述和来源文件
 */
import React, { useState } from "react";
import {
  TableOutlined,
  FileTextOutlined,
  DownOutlined,
  FieldStringOutlined,
} from "@ant-design/icons";
import type { Entity } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface EntityTabProps {
  entities: Entity[];
  moduleColor: string;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const EntityTab: React.FC<EntityTabProps> = ({ entities, moduleColor }) => {
  if (!entities.length) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: "#4a5a7a",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
        }}
      >
        <TableOutlined style={{ fontSize: 32, opacity: 0.3, marginBottom: 12, display: "block" }} />
        暂无实体数据
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entities.map((entity) => (
        <EntityCard key={entity.id} entity={entity} moduleColor={moduleColor} />
      ))}
    </div>
  );
};

// ─── 实体卡片 ────────────────────────────────────────────────────────────────

const EntityCard: React.FC<{ entity: Entity; moduleColor: string }> = ({
  entity,
  moduleColor,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "rgba(16, 22, 32, 0.5)",
        border: "1px solid rgba(255,255,255,0.04)",
        borderRadius: 8,
        overflow: "hidden",
        transition: "border-color 0.15s ease",
      }}
    >
      {/* 头部 */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          cursor: "pointer",
          background: expanded ? `${moduleColor}06` : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* 图标 */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: `${moduleColor}12`,
              border: `1px solid ${moduleColor}25`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TableOutlined style={{ color: moduleColor, fontSize: 13 }} />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#d0e0f0",
                }}
              >
                {entity.name}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: moduleColor,
                  padding: "2px 8px",
                  background: `${moduleColor}12`,
                  borderRadius: 4,
                }}
              >
                {entity.tableName}
              </span>
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#5a6a8a",
                marginTop: 2,
              }}
            >
              {entity.fields.length} 字段
            </div>
          </div>
        </div>

        <DownOutlined
          style={{
            fontSize: 10,
            color: "#5a6a8a",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        />
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div
          style={{
            padding: "0 14px 14px",
            borderTop: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          {/* 描述 */}
          <div
            style={{
              marginTop: 10,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#7a8aaa",
              lineHeight: 1.6,
            }}
          >
            {entity.description}
          </div>

          {/* 字段列表 */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <FieldStringOutlined style={{ fontSize: 11, color: "#00d4ff" }} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#5a6a8a",
                }}
              >
                字段定义
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                padding: "8px 10px",
                background: "rgba(0, 212, 255, 0.03)",
                borderRadius: 6,
                border: "1px solid rgba(0, 212, 255, 0.08)",
              }}
            >
              {entity.fields.map((field) => (
                <span
                  key={field}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "#00d4ff",
                    padding: "3px 8px",
                    background: "rgba(0, 212, 255, 0.08)",
                    borderRadius: 4,
                    border: "1px solid rgba(0, 212, 255, 0.12)",
                  }}
                >
                  {field}
                </span>
              ))}
            </div>
          </div>

          {/* 来源文件 */}
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 6,
            }}
          >
            <FileTextOutlined style={{ fontSize: 11, color: "#5a6a8a" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9,
                color: "#6a7a9a",
              }}
              title={entity.sourceFile}
            >
              {entity.sourceFile}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityTab;
