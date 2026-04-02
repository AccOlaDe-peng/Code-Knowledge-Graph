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
import {
  ApiOutlined,
  ImportOutlined,
  ExportOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  FolderOutlined,
  CodeOutlined,
} from "@ant-design/icons";
import type { SubFunction } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface FunctionTabProps {
  subFunctions: SubFunction[];
  moduleColor: string;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const FunctionTab: React.FC<FunctionTabProps> = ({
  subFunctions,
  moduleColor,
}) => {
  if (!subFunctions.length) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: "#95b0d1",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
        }}
      >
        <ApiOutlined
          style={{
            fontSize: 32,
            opacity: 0.3,
            marginBottom: 12,
            display: "block",
          }}
        />
        暂无功能数据
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {subFunctions.map((func) => (
        <FunctionCard
          key={func.id}
          subFunction={func}
          moduleColor={moduleColor}
        />
      ))}
    </div>
  );
};

// ─── 功能卡片 ────────────────────────────────────────────────────────────────

const FunctionCard: React.FC<{
  subFunction: SubFunction;
  moduleColor: string;
}> = ({ subFunction, moduleColor }) => {
  const isInternal =
    !subFunction.apiEndpoint || subFunction.apiEndpoint === "内部调用";

  return (
    <div
      style={{
        background: "rgba(16, 22, 32, 0.5)",
        border: "1px solid rgba(255,255,255,0.04)",
        borderRadius: 8,
        padding: "12px 14px",
        transition: "border-color 0.15s ease",
      }}
    >
      {/* 头部：名称 + API 端点 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        {/* 图标 */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: isInternal
              ? `${moduleColor}12`
              : "rgba(0, 212, 255, 0.12)",
            border: isInternal
              ? `1px solid ${moduleColor}25`
              : "1px solid rgba(0, 212, 255, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ApiOutlined
            style={{
              color: isInternal ? moduleColor : "#00d4ff",
              fontSize: 13,
            }}
          />
        </div>

        <div style={{ flex: 1 }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "#d0e0f0",
            }}
          >
            {subFunction.name}
          </span>
        </div>
      </div>

      {/* API 端点 */}
      {!isInternal && (
        <div
          style={{
            marginBottom: 10,
            padding: "6px 10px",
            background: "rgba(0, 212, 255, 0.04)",
            borderRadius: 6,
            border: "1px solid rgba(0, 212, 255, 0.1)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <CodeOutlined style={{ fontSize: 10, color: "#00d4ff" }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#00d4ff",
            }}
          >
            {subFunction.apiEndpoint}
          </span>
        </div>
      )}

      {/* 内部调用标识 */}
      {isInternal && (
        <div
          style={{
            marginBottom: 10,
            padding: "6px 10px",
            background: `${moduleColor}08`,
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: moduleColor,
            }}
          >
            内部调用
          </span>
        </div>
      )}

      {/* 描述 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: "#a9bfdc",
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        {subFunction.description}
      </div>

      {/* 输入输出 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {/* 输入 */}
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(255, 193, 69, 0.04)",
            borderRadius: 6,
            border: "1px solid rgba(255, 193, 69, 0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 6,
            }}
          >
            <ImportOutlined style={{ fontSize: 10, color: "#ffc145" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#b6c9e8",
              }}
            >
              输入来源
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {subFunction.inputSource.length > 0 ? (
              subFunction.inputSource.map((input) => (
                <span
                  key={input}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "#ffc145",
                    padding: "2px 6px",
                    background: "rgba(255, 193, 69, 0.1)",
                    borderRadius: 3,
                  }}
                >
                  {input}
                </span>
              ))
            ) : (
              <span style={{ fontSize: 10, color: "#95b0d1" }}>-</span>
            )}
          </div>
        </div>

        {/* 输出 */}
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(0, 240, 132, 0.04)",
            borderRadius: 6,
            border: "1px solid rgba(0, 240, 132, 0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 6,
            }}
          >
            <ExportOutlined style={{ fontSize: 10, color: "#00f084" }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#b6c9e8",
              }}
            >
              输出目标
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {subFunction.outputTarget.length > 0 ? (
              subFunction.outputTarget.map((output) => (
                <span
                  key={output}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "#00f084",
                    padding: "2px 6px",
                    background: "rgba(0, 240, 132, 0.1)",
                    borderRadius: 3,
                  }}
                >
                  {output}
                </span>
              ))
            ) : (
              <span style={{ fontSize: 10, color: "#95b0d1" }}>-</span>
            )}
          </div>
        </div>
      </div>

      {/* 关联信息 */}
      <div
        style={{
          display: "flex",
          gap: 12,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.03)",
        }}
      >
        {subFunction.relatedEntities.length > 0 && (
          <RelationBadge
            icon={<DatabaseOutlined />}
            count={subFunction.relatedEntities.length}
            label="实体"
            color="#00f084"
          />
        )}
        {subFunction.relatedServices.length > 0 && (
          <RelationBadge
            icon={<AppstoreOutlined />}
            count={subFunction.relatedServices.length}
            label="服务"
            color="#00d4ff"
          />
        )}
        {subFunction.relatedDAO.length > 0 && (
          <RelationBadge
            icon={<FolderOutlined />}
            count={subFunction.relatedDAO.length}
            label="DAO"
            color="#00f084"
          />
        )}
      </div>
    </div>
  );
};

// ─── 关联徽章组件 ─────────────────────────────────────────────────────────────

const RelationBadge: React.FC<{
  icon: React.ReactNode;
  count: number;
  label: string;
  color: string;
}> = ({ icon, count, label, color }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 10px",
      background: `${color}08`,
      borderRadius: 4,
      border: `1px solid ${color}15`,
    }}
  >
    <span style={{ fontSize: 10, color }}>{icon}</span>
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      {count}
    </span>
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        color: "#b3c7e4",
      }}
    >
      {label}
    </span>
  </div>
);

export default FunctionTab;
