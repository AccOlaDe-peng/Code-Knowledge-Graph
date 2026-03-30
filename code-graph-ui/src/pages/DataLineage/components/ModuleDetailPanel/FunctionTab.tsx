/**
 * FunctionTab - 功能 Tab 组件。
 *
 * 列表展示模块的所有子功能：
 * - 功能名称和 API 端点
 * - 描述
 * - 输入来源 / 输出目标
 * - 关联实体 / 服务 / DAO
 */
import React from "react";
import { Tag } from "antd";
import {
  ApiOutlined,
  ImportOutlined,
  ExportOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import type { SubFunction } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface FunctionTabProps {
  subFunctions: SubFunction[];
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const FunctionTab: React.FC<FunctionTabProps> = ({ subFunctions }) => {
  if (!subFunctions.length) {
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
        暂无功能数据
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {subFunctions.map((func) => (
        <FunctionCard key={func.id} subFunction={func} />
      ))}
    </div>
  );
};

// ─── 功能卡片 ────────────────────────────────────────────────────────────────

const FunctionCard: React.FC<{ subFunction: SubFunction }> = ({ subFunction }) => {
  return (
    <div
      style={{
        background: "rgba(20, 30, 45, 0.5)",
        border: "1px solid var(--b-subtle)",
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      {/* 头部：名称 + API 端点 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <ApiOutlined style={{ color: "#00d4ff", fontSize: 13 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 12,
            fontWeight: 600,
            color: "#d0e0f0",
          }}
        >
          {subFunction.name}
        </span>
      </div>

      {/* API 端点 */}
      {subFunction.apiEndpoint && subFunction.apiEndpoint !== "内部调用" && (
        <Tag
          style={{
            background: "rgba(0, 212, 255, 0.1)",
            border: "1px solid rgba(0, 212, 255, 0.2)",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: "#00d4ff",
            marginBottom: 8,
          }}
        >
          {subFunction.apiEndpoint}
        </Tag>
      )}

      {/* 描述 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono'",
          fontSize: 10,
          color: "#7888a8",
          marginBottom: 10,
          lineHeight: 1.4,
        }}
      >
        {subFunction.description}
      </div>

      {/* 输入输出 */}
      <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <ImportOutlined style={{ fontSize: 9, color: "#ffc145" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              输入
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {subFunction.inputSource.map((input) => (
              <Tag
                key={input}
                style={{
                  background: "rgba(255, 193, 69, 0.08)",
                  border: "none",
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#ffc145",
                  margin: 0,
                }}
              >
                {input}
              </Tag>
            ))}
          </div>
        </div>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <ExportOutlined style={{ fontSize: 9, color: "#00f084" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              输出
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {subFunction.outputTarget.map((output) => (
              <Tag
                key={output}
                style={{
                  background: "rgba(0, 240, 132, 0.08)",
                  border: "none",
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#00f084",
                  margin: 0,
                }}
              >
                {output}
              </Tag>
            ))}
          </div>
        </div>
      </div>

      {/* 关联信息 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {subFunction.relatedEntities.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <DatabaseOutlined style={{ fontSize: 9, color: "#b08eff" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              {subFunction.relatedEntities.length} 实体
            </span>
          </div>
        )}
        {subFunction.relatedServices.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <AppstoreOutlined style={{ fontSize: 9, color: "#00d4ff" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              {subFunction.relatedServices.length} 服务
            </span>
          </div>
        )}
        {subFunction.relatedDAO.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <FolderOutlined style={{ fontSize: 9, color: "#00f084" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#5a6a8a",
              }}
            >
              {subFunction.relatedDAO.length} DAO
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FunctionTab;
