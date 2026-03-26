/**
 * DataLineage - 数据血缘主页面。
 *
 * 支持两种视图模式：
 * - 技术架构视图：按技术模块聚合（adms-api, adms-repository...）
 * - 业务领域视图：按业务领域聚合（drs, mdm, frs...）
 *
 * 三层渐进式视图：
 * - 层级 1: 主图（模块/领域）
 * - 层级 2: 内部视图（Service）
 * - 层级 3: 详细血缘（Function）
 */
import React, { useEffect, useState, useCallback } from "react";
import { ReactFlowProvider } from "reactflow";
import "reactflow/dist/style.css";
import { Spin, Button, Tooltip, Input, Tag } from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useLineageLevel, useLineageNavigation, useViewMode, useDomainConfig, useDomainInteraction } from "../../store/lineageStore";
import { useRepoStore } from "../../store/repoStore";
import { graphApi } from "../../api/graphApi";
import { domainApi } from "../../api/domainApi";
import RepoSelector from "../../components/ui/RepoSelector";
import ModuleView from "./components/ModuleView";
import ServiceView from "./components/ServiceView";
import DetailView from "./components/DetailView";
import BusinessDomainView from "./components/BusinessDomainView";
import DomainDetailView from "./components/DomainDetailView";
import ViewModeSelector from "./components/ViewModeSelector";
import DomainConfigPanel from "./components/DomainConfigPanel";
import type { ModuleInfo, DomainInfo } from "../../store/lineageStore";
import type { GraphNode } from "../../types/graph";
import type { BusinessDomainNode } from "./utils/domainAggregation";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface RawNode {
  id: string;
  type: string;
  name?: string;
  properties?: Record<string, unknown>;
}

interface RawEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
}

// ─── 内部组件 ────────────────────────────────────────────────────────────────

const DataLineageInner: React.FC = () => {
  const { selectedModule, selectedService, isModuleView, isServiceView, isDetailView } = useLineageLevel();
  const { navigateToModule, navigateToService, navigateBack, reset } = useLineageNavigation();
  const { isBusinessView, isTechView } = useViewMode();
  const { domainConfig, inferredDomains, domainLoading, setDomainConfig, setInferredDomains, setDomainLoading } = useDomainConfig();
  const {
    selectedDomain,
    domainLevel,
    navigateToDomain,
    navigateFromDomain,
  } = useDomainInteraction();
  const { activeRepo } = useRepoStore();

  // 数据状态
  const [nodes, setNodes] = useState<RawNode[]>([]);
  const [edges, setEdges] = useState<RawEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 加载模块级数据
  useEffect(() => {
    if (!activeRepo?.repoId || !isModuleView) return;

    setLoading(true);
    setError(null);

    // 加载完整血缘数据，前端聚合为模块级
    graphApi
      .getLineageView(activeRepo.repoId, { includeCalls: true })
      .then((res) => {
        setNodes(res.nodes);
        setEdges(res.edges);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [activeRepo?.repoId, isModuleView]);

  // 加载领域配置（业务视图模式）
  useEffect(() => {
    if (!activeRepo?.repoId || !isBusinessView) return;

    setDomainLoading(true);
    Promise.all([
      domainApi.getDomainConfig(activeRepo.repoId),
      domainApi.inferDomains(activeRepo.repoId),
    ])
      .then(([config, inferred]) => {
        setDomainConfig(config);
        setInferredDomains(inferred);
        setDomainLoading(false);
      })
      .catch((err) => {
        console.error("加载领域配置失败:", err);
        setDomainLoading(false);
      });
  }, [activeRepo?.repoId, isBusinessView, setDomainConfig, setInferredDomains, setDomainLoading]);

  // 处理模块点击
  const handleModuleClick = useCallback(
    (_moduleId: string, module: ModuleInfo) => {
      navigateToModule(module);
    },
    [navigateToModule]
  );

  // 处理服务点击
  const handleServiceClick = useCallback(
    (serviceId: string, service: GraphNode) => {
      navigateToService({
        id: serviceId,
        name: service.label || serviceId.split(":").pop() || serviceId,
        type: service.type,
      });
    },
    [navigateToService]
  );

  // 处理领域双击（进入子图）
  const handleDomainDoubleClick = useCallback(
    (_domainId: string, domain: BusinessDomainNode) => {
      const domainInfo: DomainInfo = {
        id: domain.id,
        key: domain.key,
        name: domain.name,
        color: domain.color,
        nodeCount: domain.nodeCount,
        serviceCount: domain.services.length,
        controllerCount: domain.controllers.length,
        repositoryCount: domain.repositories.length,
        crossDomainCalls: 0,
        nodeIds: domain.nodeIds,
      };
      navigateToDomain(domainInfo);
    },
    [navigateToDomain]
  );

  // 从领域子图返回
  const handleDomainBack = useCallback(() => {
    navigateFromDomain();
  }, [navigateFromDomain]);

  // 重置视图
  const handleReset = useCallback(() => {
    reset();
    setSearchQuery("");
  }, [reset]);

  // 获取标题
  const getTitle = () => {
    if (isDetailView && selectedService) {
      return selectedService.name;
    }
    if (isServiceView && selectedModule) {
      return selectedModule.name;
    }
    return "数据血缘";
  };

  // 获取节点和边计数
  const stats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#07090d",
      }}
    >
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 16px",
          borderBottom: "1px solid #0d1a24",
          background: "rgba(7,9,13,0.97)",
          backdropFilter: "blur(12px)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: 1,
              background: "#b08eff",
              boxShadow: "0 0 10px #b08effaa",
            }}
          />
          <span
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              color: "#b08eff",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {getTitle()}
          </span>
        </div>

        {/* 层级指示器 */}
        <div style={{ display: "flex", gap: 4 }}>
          <Tag
            color={isModuleView ? "#b08eff" : "#1a2535"}
            style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, margin: 0 }}
          >
            模块
          </Tag>
          {selectedModule && (
            <Tag
              color={isServiceView ? "#00d4ff" : "#1a2535"}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, margin: 0 }}
            >
              服务
            </Tag>
          )}
          {selectedService && (
            <Tag
              color={isDetailView ? "#00f084" : "#1a2535"}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, margin: 0 }}
            >
              详情
            </Tag>
          )}
        </div>

        {/* 返回按钮 */}
        {(isServiceView || isDetailView) && (
          <Button
            size="small"
            onClick={navigateBack}
            style={{
              background: "#080e16",
              border: "1px solid #1a2535",
              color: "#8ab4c8",
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
            }}
          >
            ← 返回
          </Button>
        )}

        {/* 仓库选择器 */}
        <RepoSelector showStats={false} width={200} />

        {/* 视图模式选择器 */}
        <ViewModeSelector />

        {/* 领域配置（仅业务视图模式） */}
        {isBusinessView && activeRepo && (
          <DomainConfigPanel
            repoId={activeRepo.repoId}
            domains={domainConfig?.domains || []}
            inferredDomains={inferredDomains}
            loading={domainLoading}
            onDomainsChange={(domains) => setDomainConfig(
              domainConfig
                ? { ...domainConfig, domains }
                : { repoId: activeRepo.repoId, version: 1, lastModified: new Date().toISOString(), domains }
            )}
            onInferredDomainsChange={setInferredDomains}
          />
        )}

        {/* 统计 */}
        {isModuleView && (
          <div style={{ display: "flex", gap: 16, marginRight: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#b08eff",
                }}
              >
                {stats.nodeCount.toLocaleString()}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#3a5a6a",
                  letterSpacing: "0.1em",
                }}
              >
                节点
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#00d4ff",
                }}
              >
                {stats.edgeCount.toLocaleString()}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 9,
                  color: "#3a5a6a",
                  letterSpacing: "0.1em",
                }}
              >
                关系
              </span>
            </div>
          </div>
        )}

        {/* 搜索（仅模块视图） */}
        {isModuleView && (
          <Input
            prefix={<SearchOutlined style={{ color: "#2a4a5a", fontSize: 11 }} />}
            placeholder="搜索节点..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: 160,
              background: "#080e16",
              border: "1px solid #1a2535",
              borderRadius: 3,
              color: "#8ab4c8",
              fontFamily: "'IBM Plex Mono'",
              fontSize: 11,
            }}
            allowClear
          />
        )}

        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            style={{
              background: "#080e16",
              border: "1px solid #1a2535",
              color: "#2a4a5a",
            }}
          />
        </Tooltip>
      </div>

      {/* 主内容区 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 加载状态 */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(7,9,13,0.85)",
              zIndex: 10,
              gap: 12,
            }}
          >
            <Spin size="large" />
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 10,
                color: "#2a4a6a",
                letterSpacing: "0.12em",
              }}
            >
              加载数据血缘...
            </span>
          </div>
        )}

        {/* 错误状态 */}
        {error && !loading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <div style={{ color: "#ff6b6b", fontSize: 24 }}>⚠️</div>
            <div style={{ color: "#ff6b6b", fontFamily: "'IBM Plex Mono'", fontSize: 11 }}>
              加载失败: {error}
            </div>
            <Button onClick={handleReset} size="small">
              重试
            </Button>
          </div>
        )}

        {/* 未选择仓库 */}
        {!activeRepo && !loading && !error && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, opacity: 0.06, marginBottom: 12 }}>◈</div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 11,
                  color: "#2a4a6a",
                  letterSpacing: "0.1em",
                }}
              >
                请从顶栏选择一个仓库
              </div>
            </div>
          </div>
        )}

        {/* 层级 1a: 模块主图 - 技术架构视图 */}
        {activeRepo && isModuleView && isTechView && !loading && !error && (
          <ModuleView
            repoId={activeRepo.repoId}
            nodes={nodes}
            edges={edges}
            loading={loading}
            onModuleClick={handleModuleClick}
          />
        )}

        {/* 层级 1b: 业务领域视图 - 主图 */}
        {activeRepo && isModuleView && isBusinessView && domainLevel === "main" && !loading && !error && (
          <BusinessDomainView
            nodes={nodes}
            edges={edges}
            domains={domainConfig?.domains || []}
            inferredDomains={inferredDomains}
            loading={loading}
            onDomainDoubleClick={handleDomainDoubleClick}
          />
        )}

        {/* 层级 1c: 业务领域视图 - 子图 */}
        {activeRepo && isModuleView && isBusinessView && domainLevel === "subgraph" && selectedDomain && !error && (
          <DomainDetailView
            repoId={activeRepo.repoId}
            domain={selectedDomain}
            allNodes={nodes}
            allEdges={edges}
            onBack={handleDomainBack}
          />
        )}

        {/* 层级 2: 模块内视图 */}
        {activeRepo && isServiceView && selectedModule && !error && (
          <ServiceView
            repoId={activeRepo.repoId}
            moduleId={selectedModule.id}
            module={selectedModule}
            onBack={navigateBack}
            onServiceClick={handleServiceClick}
          />
        )}

        {/* 层级 3: 详细血缘 */}
        {activeRepo && isDetailView && selectedService && !error && (
          <DetailView
            repoId={activeRepo.repoId}
            serviceId={selectedService.id}
            serviceName={selectedService.name}
            onBack={navigateBack}
          />
        )}
      </div>
    </div>
  );
};

// ─── 导出组件 ────────────────────────────────────────────────────────────────

const DataLineage: React.FC = () => (
  <ReactFlowProvider>
    <DataLineageInner />
  </ReactFlowProvider>
);

export default DataLineage;
