import React from "react";
import { Progress } from "antd";
import {
  CheckCircleFilled,
  LoadingOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { usePipelineStore } from "../../../store/pipelineStore";
import type { RepoInfo } from "../../../types/api";

interface AnalysisProgressPanelProps {
  repo: RepoInfo;
}

export const AnalysisProgressPanel: React.FC<AnalysisProgressPanelProps> = ({ repo }) => {
  const stages = usePipelineStore((s) => s.stages);
  const total = repo.analysisTotal ?? stages.length;
  const currentStage = repo.analysisStage ?? "";

  // 根据当前阶段 key 找到索引
  const currentStageIndex = stages.findIndex((s) => s.key === currentStage);
  const step = currentStageIndex >= 0 ? currentStageIndex + 1 : 0;
  const percent = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;

  // 当前阶段信息
  const currentStageInfo = stages.find((s) => s.key === currentStage);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(0,212,255,0.06) 0%, rgba(0,212,255,0.02) 100%)",
        border: "1px solid rgba(0,212,255,0.15)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <LoadingOutlined
            spin
            style={{ color: "var(--t-cyan)", fontSize: 14 }}
          />
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--t-cyan)",
            }}
          >
            分析进行中
          </span>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--t-muted)",
          }}
        >
          {step}/{total} 阶段
        </span>
      </div>

      {/* Progress Bar */}
      <Progress
        percent={percent}
        strokeColor={{
          "0%": "#00d4ff",
          "100%": "#00f084",
        }}
        trailColor="rgba(0,212,255,0.1)"
        showInfo={false}
        size="small"
        style={{ marginBottom: 12 }}
      />

      {/* Current Stage Info */}
      <div
        style={{
          padding: "10px 12px",
          background: "rgba(0,0,0,0.2)",
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--t-primary)",
            marginBottom: 2,
          }}
        >
          {currentStageInfo ? currentStageInfo.label : repo.analysisStage || "等待调度"}
        </div>
        {currentStageInfo && (
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              color: "var(--t-muted)",
            }}
          >
            {currentStageInfo.description}
          </div>
        )}
        {repo.analysisMessage && (
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--t-secondary)",
              padding: "4px 8px",
              background: "rgba(0,212,255,0.05)",
              borderRadius: 4,
            }}
          >
            {repo.analysisMessage}
          </div>
        )}
      </div>

      {/* Stages Timeline */}
      <div
        style={{
          maxHeight: 200,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {stages.map((stage, index) => {
          const stageIndex = index + 1;
          const isCompleted = stageIndex < step;
          const isCurrent = stageIndex === step;

          return (
            <div
              key={stage.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: isCurrent
                  ? "rgba(0,212,255,0.06)"
                  : "transparent",
                borderRadius: 4,
                transition: "background 0.15s ease",
              }}
            >
              {/* Status Icon */}
              <div
                style={{
                  width: 20,
                  height: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isCompleted ? (
                  <CheckCircleFilled
                    style={{ fontSize: 14, color: "var(--t-green)" }}
                  />
                ) : isCurrent ? (
                  <LoadingOutlined
                    spin
                    style={{ fontSize: 14, color: "var(--t-cyan)" }}
                  />
                ) : (
                  <ClockCircleOutlined
                    style={{ fontSize: 14, color: "var(--t-muted)", opacity: 0.5 }}
                  />
                )}
              </div>

              {/* Stage Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--t-muted)",
                    }}
                  >
                    {String(stageIndex).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      color: isCompleted || isCurrent
                        ? "var(--t-secondary)"
                        : "var(--t-muted)",
                    }}
                  >
                    {stage.label}
                  </span>
                </div>
                {(isCompleted || isCurrent) && stage.description && (
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 10,
                      color: "var(--t-muted)",
                      marginLeft: 20,
                      marginTop: 1,
                    }}
                  >
                    {stage.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
