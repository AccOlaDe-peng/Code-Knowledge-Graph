/**
 * EntityTab - 实体 Tab 组件。
 *
 * 列表展示模块的所有数据实体：
 * - 实体名称和表名
 * - 字段列表（可折叠）
 * - 描述和来源文件
 */
import React, { useState } from "react";
import { Tag } from "antd";
import {
  TableOutlined,
  FileTextOutlined,
  DownOutlined,
} from "@ant-design/icons";
import type { Entity } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface EntityTabProps {
  entities: Entity[];
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const EntityTab: React.FC<EntityTabProps> = ({ entities }) => {
  if (!entities.length) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 24,
          color: "#5a6a8a",
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
        }}
      >
        暂无实体数据
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entities.map((entity) => (
        <EntityCard key={entity.id} entity={entity} />
      ))}
    </div>
  );
};

// ─── 实体卡片 ────────────────────────────────────────────────────────────────

const EntityCard: React.FC<{ entity: Entity }> = ({ entity }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "rgba(20, 30, 45, 0.5)",
        border: "1px solid var(--b-subtle)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* 头部 */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TableOutlined style={{ color: "#b08eff", fontSize: 14 }} />
          <div>
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 12,
                fontWeight: 600,
                color: "#d0e0f0",
              }}
            >
              {entity.name}
            </span>
            <Tag
              style={{
                marginLeft: 8,
                background: "rgba(176, 142, 255, 0.15)",
                border: "none",
                fontFamily: "'IBM Plex Mono'",
                fontSize: 10,
                color: "#b08eff",
              }}
            >
              {entity.tableName}
            </Tag>
          </div>
        </div>
        <DownOutlined
          style={{
            fontSize: 10,
            color: "#5a6a8a",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.2s",
          }}
        />
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div
          style={{
            padding: "0 12px 12px",
            borderTop: "1px solid var(--b-subtle)",
          }}
        >
          {/* 描述 */}
          <div
            style={{
              marginTop: 8,
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "#7888a8",
              lineHeight: 1.5,
            }}
          >
            {entity.description}
          </div>

          {/* 字段列表 */}
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 10,
                color: "#5a6a8a",
                marginBottom: 6,
              }}
            >
              字段 ({entity.fields.length})
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              {entity.fields.map((field) => (
                <Tag
                  key={field}
                  style={{
                    background: "rgba(0, 212, 255, 0.08)",
                    border: "1px solid rgba(0, 212, 255, 0.2)",
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 9,
                    color: "#00d4ff",
                    margin: 0,
                  }}
                >
                  {field}
                </Tag>
              ))}
            </div>
          </div>

          {/* 来源文件 */}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <FileTextOutlined style={{ fontSize: 10, color: "#5a6a8a" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
              title={entity.sourceFile}
            >
              {entity.sourceFile.split("/").pop()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityTab;
