import React from "react";
import { Progress, Timeline } from "antd";
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
    <div>
      <Progress
        percent={percent}
        strokeColor={{ "0%": "#00d4ff", "100%": "#00f084" }}
        trailColor="var(--s-float)"
      />

      <div
        style={{
          marginTop: 10,
          marginBottom: 12,
          padding: "10px 12px",
          background: "rgba(0,212,255,0.06)",
          border: "1px solid rgba(0,212,255,0.2)",
          borderRadius: 4,
          fontFamily: "'IBM Plex Mono'",
        }}
      >
        <div style={{ fontSize: 11, color: "#00d4ff", marginBottom: 4 }}>
          当前进度: {step}/{total}
        </div>
        <div style={{ fontSize: 12, color: "var(--t-secondary)" }}>
          {currentStageInfo ? currentStageInfo.label : repo.analysisStage || "等待调度"}
        </div>
        {currentStageInfo && (
          <div style={{ marginTop: 2, fontSize: 10, color: "var(--t-muted)" }}>
            {currentStageInfo.description}
          </div>
        )}
        {repo.analysisMessage && (
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--t-muted)" }}>
            {repo.analysisMessage}
          </div>
        )}
      </div>

      <div
        style={{
          maxHeight: 280,
          overflowY: "auto",
          padding: "10px 12px",
          background: "var(--s-float)",
          border: "1px solid var(--b-faint)",
          borderRadius: 4,
        }}
      >
        <Timeline
          items={stages.map((stage, index) => {
            const stageIndex = index + 1;
            const isCompleted = stageIndex < step;
            const isCurrent = stageIndex === step;
            const color = isCompleted
              ? "#00f084"
              : isCurrent
                ? "#00d4ff"
                : "#3d4a5d";
            return {
              color,
              children: (
                <div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 11,
                      color:
                        stageIndex <= step
                          ? "var(--t-secondary)"
                          : "var(--t-muted)",
                    }}
                  >
                    {stageIndex}. {stage.label}
                  </span>
                  {(isCompleted || isCurrent) && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--t-muted)",
                        marginTop: 2,
                      }}
                    >
                      {stage.description}
                    </div>
                  )}
                </div>
              ),
            };
          })}
        />
      </div>
    </div>
  );
};
