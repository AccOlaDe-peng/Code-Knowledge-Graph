/**
 * DomainConfigPanel - 领域配置管理面板。
 *
 * 允许用户管理业务领域定义，包括：
 * - 查看/编辑已定义领域
 * - 添加/删除领域
 * - 配置领域别名和颜色
 * - 查看并接受推断领域建议
 */
import React, { useState, useCallback } from "react";
import {
  Drawer,
  Button,
  Input,
  Tag,
  Tooltip,
  Empty,
  Spin,
  Divider,
  message,
  Popconfirm,
  ColorPicker,
} from "antd";
import type { Color } from "antd/es/color-picker";
import {
  SettingOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  BulbOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import type { DomainDefinition, InferredDomain } from "../../../store/lineageStore";
import { domainApi } from "../../../api/domainApi";

// ─── 预设颜色 ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#00d4ff", // 青色
  "#00f084", // 绿色
  "#ffc145", // 琥珀色
  "#b08eff", // 紫色
  "#ff6b6b", // 红色
  "#7ed957", // 浅绿
  "#ffcc44", // 黄色
  "#44aaff", // 浅蓝
  "#ff9f43", // 橙色
  "#a55eea", // 深紫
];

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface DomainConfigPanelProps {
  repoId: string;
  domains: DomainDefinition[];
  inferredDomains: InferredDomain[];
  loading?: boolean;
  onDomainsChange: (domains: DomainDefinition[]) => void;
  onInferredDomainsChange: (domains: InferredDomain[]) => void;
}

interface EditingDomain {
  id: string;
  key: string;
  name: string;
  aliases: string[];
  color: string;
  isNew?: boolean;
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

const DomainConfigPanel: React.FC<DomainConfigPanelProps> = ({
  repoId,
  domains,
  inferredDomains,
  loading,
  onDomainsChange,
  onInferredDomainsChange,
}) => {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingDomain, setEditingDomain] = useState<EditingDomain | null>(null);
  const [newAlias, setNewAlias] = useState("");

  // 保存领域配置
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await domainApi.saveDomainConfig(repoId, domains);
      message.success("领域配置已保存");
    } catch (err) {
      message.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [repoId, domains]);

  // 添加新领域
  const handleAddDomain = useCallback(() => {
    const newId = `domain:new-${Date.now()}`;
    setEditingDomain({
      id: newId,
      key: "",
      name: "",
      aliases: [],
      color: PRESET_COLORS[domains.length % PRESET_COLORS.length],
      isNew: true,
    });
  }, [domains.length]);

  // 编辑领域
  const handleEditDomain = useCallback((domain: DomainDefinition) => {
    setEditingDomain({
      id: domain.id,
      key: domain.key,
      name: domain.name,
      aliases: [...domain.aliases],
      color: domain.color,
      isNew: false,
    });
  }, []);

  // 删除领域
  const handleDeleteDomain = useCallback(
    (domainId: string) => {
      const newDomains = domains.filter((d) => d.id !== domainId);
      onDomainsChange(newDomains);
    },
    [domains, onDomainsChange]
  );

  // 保存编辑
  const handleSaveEdit = useCallback(() => {
    if (!editingDomain) return;

    if (!editingDomain.key.trim()) {
      message.warning("领域关键字不能为空");
      return;
    }
    if (!editingDomain.name.trim()) {
      message.warning("领域名称不能为空");
      return;
    }

    const newDomain: DomainDefinition = {
      id: editingDomain.id.startsWith("domain:new-")
        ? `domain:${editingDomain.key.toLowerCase()}`
        : editingDomain.id,
      key: editingDomain.key.toLowerCase(),
      name: editingDomain.name,
      aliases: editingDomain.aliases.map((a) => a.toLowerCase()),
      color: editingDomain.color,
    };

    if (editingDomain.isNew) {
      onDomainsChange([...domains, newDomain]);
    } else {
      onDomainsChange(
        domains.map((d) => (d.id === editingDomain.id ? newDomain : d))
      );
    }

    setEditingDomain(null);
    setNewAlias("");
  }, [editingDomain, domains, onDomainsChange]);

  // 取消编辑
  const handleCancelEdit = useCallback(() => {
    setEditingDomain(null);
    setNewAlias("");
  }, []);

  // 添加别名
  const handleAddAlias = useCallback(() => {
    if (!editingDomain || !newAlias.trim()) return;

    const alias = newAlias.trim().toLowerCase();
    if (editingDomain.aliases.includes(alias)) {
      message.warning("别名已存在");
      return;
    }

    setEditingDomain({
      ...editingDomain,
      aliases: [...editingDomain.aliases, alias],
    });
    setNewAlias("");
  }, [editingDomain, newAlias]);

  // 删除别名
  const handleRemoveAlias = useCallback(
    (alias: string) => {
      if (!editingDomain) return;
      setEditingDomain({
        ...editingDomain,
        aliases: editingDomain.aliases.filter((a) => a !== alias),
      });
    },
    [editingDomain]
  );

  // 接受推断领域
  const handleAcceptInferred = useCallback(
    (inferred: InferredDomain) => {
      const newDomain: DomainDefinition = {
        id: `domain:${inferred.key.toLowerCase()}`,
        key: inferred.key.toLowerCase(),
        name: inferred.suggestedName,
        aliases: inferred.relatedKeys.map((k) => k.toLowerCase()),
        color: inferred.suggestedColor,
      };

      onDomainsChange([...domains, newDomain]);
      onInferredDomainsChange(
        inferredDomains.filter((d) => d.key !== inferred.key)
      );
      message.success(`已添加领域: ${inferred.suggestedName}`);
    },
    [domains, inferredDomains, onDomainsChange, onInferredDomainsChange]
  );

  // 忽略推断领域
  const handleIgnoreInferred = useCallback(
    (key: string) => {
      onInferredDomainsChange(
        inferredDomains.filter((d) => d.key !== key)
      );
    },
    [inferredDomains, onInferredDomainsChange]
  );

  // 颜色选择
  const handleColorChange = useCallback(
    (color: Color) => {
      if (!editingDomain) return;
      setEditingDomain({
        ...editingDomain,
        color: typeof color === "string" ? color : color.toHexString(),
      });
    },
    [editingDomain]
  );

  return (
    <>
      {/* 触发按钮 */}
      <Tooltip title="领域配置">
        <Button
          icon={<SettingOutlined />}
          onClick={() => setVisible(true)}
          size="small"
          style={{
            background: "#080e16",
            border: "1px solid #1a2535",
            color: "#8ab4c8",
          }}
        />
      </Tooltip>

      {/* 抽屉 */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AppstoreOutlined style={{ color: "#b08eff" }} />
            <span
              style={{
                fontFamily: "'Syne', sans-serif",
                fontWeight: 600,
                color: "#b08eff",
              }}
            >
              业务领域配置
            </span>
          </div>
        }
        placement="right"
        width={420}
        open={visible}
        onClose={() => setVisible(false)}
        styles={{
          header: { background: "#07090d", borderBottom: "1px solid #1a2535" },
          body: { background: "#07090d", padding: 16 },
          footer: {
            background: "#07090d",
            borderTop: "1px solid #1a2535",
            padding: "12px 16px",
          },
        }}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button onClick={() => setVisible(false)}>关闭</Button>
            <Button
              type="primary"
              onClick={handleSave}
              loading={saving}
              style={{
                background: "#00f084",
                borderColor: "#00f084",
                color: "#07090d",
              }}
            >
              保存配置
            </Button>
          </div>
        }
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <>
            {/* 已定义领域 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 11,
                  color: "#6b8aaa",
                  letterSpacing: "0.1em",
                }}
              >
                已定义领域 ({domains.length})
              </span>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                size="small"
                onClick={handleAddDomain}
                style={{
                  background: "#00d4ff",
                  borderColor: "#00d4ff",
                  color: "#07090d",
                  fontSize: 10,
                }}
              >
                添加
              </Button>
            </div>

            {domains.length === 0 ? (
              <Empty
                description="暂无定义领域"
                style={{ margin: "20px 0" }}
                imageStyle={{ height: 40 }}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {domains.map((domain) => (
                  <div
                    key={domain.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: "rgba(10,15,22,0.6)",
                      border: `1px solid ${domain.color}33`,
                      borderRadius: 6,
                    }}
                  >
                    {/* 色条 */}
                    <div
                      style={{
                        width: 4,
                        height: 28,
                        borderRadius: 2,
                        background: domain.color,
                        flexShrink: 0,
                      }}
                    />
                    {/* 名称 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "'Syne', sans-serif",
                          fontSize: 12,
                          fontWeight: 600,
                          color: domain.color,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {domain.name}
                      </div>
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono'",
                          fontSize: 9,
                          color: "#4a6a7a",
                        }}
                      >
                        {domain.key}
                        {domain.aliases.length > 0 && (
                          <span style={{ marginLeft: 4, color: "#3a5a6a" }}>
                            | {domain.aliases.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 操作 */}
                    <Button
                      icon={<EditOutlined />}
                      size="small"
                      type="text"
                      onClick={() => handleEditDomain(domain)}
                      style={{ color: "#6b8aaa" }}
                    />
                    <Popconfirm
                      title="删除此领域？"
                      onConfirm={() => handleDeleteDomain(domain.id)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button
                        icon={<DeleteOutlined />}
                        size="small"
                        type="text"
                        danger
                        style={{ color: "#ff6b6b66" }}
                      />
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}

            {/* 推断领域建议 */}
            {inferredDomains.length > 0 && (
              <>
                <Divider style={{ borderColor: "#1a2535", margin: "20px 0" }} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 12,
                  }}
                >
                  <BulbOutlined style={{ color: "#ffc145", fontSize: 12 }} />
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 11,
                      color: "#6b8aaa",
                      letterSpacing: "0.1em",
                    }}
                  >
                    推断建议 ({inferredDomains.length})
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {inferredDomains.map((inferred) => (
                    <div
                      key={inferred.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "rgba(255,193,69,0.05)",
                        border: "1px solid #ffc14533",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Syne', sans-serif",
                            fontSize: 12,
                            color: "#ffc145",
                          }}
                        >
                          {inferred.suggestedName}
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono'",
                              fontSize: 9,
                              color: "#6b8aaa",
                              marginLeft: 6,
                            }}
                          >
                            ({inferred.nodeCount} 节点)
                          </span>
                        </div>
                        <div
                          style={{
                            fontFamily: "'IBM Plex Mono'",
                            fontSize: 9,
                            color: "#4a6a7a",
                            marginTop: 2,
                          }}
                        >
                          {inferred.key}
                          {inferred.confidence < 0.8 && (
                            <Tag
                              color="#ff6b6b22"
                              style={{
                                marginLeft: 6,
                                fontSize: 8,
                                color: "#ff6b6b",
                                border: "none",
                              }}
                            >
                              低置信度
                            </Tag>
                          )}
                        </div>
                      </div>
                      <Button
                        icon={<CheckOutlined />}
                        size="small"
                        type="text"
                        onClick={() => handleAcceptInferred(inferred)}
                        style={{ color: "#00f084" }}
                      />
                      <Button
                        icon={<CloseOutlined />}
                        size="small"
                        type="text"
                        onClick={() => handleIgnoreInferred(inferred.key)}
                        style={{ color: "#ff6b6b66" }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* 编辑领域 */}
            {editingDomain && (
              <Drawer
                title={
                  editingDomain.isNew ? "添加领域" : "编辑领域"
                }
                placement="right"
                width={340}
                open={!!editingDomain}
                onClose={handleCancelEdit}
                styles={{
                  header: { background: "#07090d", borderBottom: "1px solid #1a2535" },
                  body: { background: "#07090d", padding: 16 },
                  footer: {
                    background: "#07090d",
                    borderTop: "1px solid #1a2535",
                    padding: "12px 16px",
                  },
                }}
                footer={
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Button onClick={handleCancelEdit}>取消</Button>
                    <Button
                      type="primary"
                      onClick={handleSaveEdit}
                      style={{
                        background: "#00f084",
                        borderColor: "#00f084",
                        color: "#07090d",
                      }}
                    >
                      确定
                    </Button>
                  </div>
                }
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* 颜色 */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 10,
                        color: "#6b8aaa",
                        marginBottom: 6,
                      }}
                    >
                      颜色
                    </label>
                    <ColorPicker
                      value={editingDomain.color}
                      onChange={handleColorChange}
                      presets={[
                        {
                          label: "预设颜色",
                          colors: PRESET_COLORS,
                        },
                      ]}
                      style={{ width: "100%" }}
                    />
                  </div>

                  {/* 关键字 */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 10,
                        color: "#6b8aaa",
                        marginBottom: 6,
                      }}
                    >
                      关键字 *
                    </label>
                    <Input
                      value={editingDomain.key}
                      onChange={(e) =>
                        setEditingDomain({ ...editingDomain, key: e.target.value })
                      }
                      placeholder="如: drs, mdm"
                      style={{
                        background: "#080e16",
                        border: "1px solid #1a2535",
                        color: "#8ab4c8",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 11,
                      }}
                    />
                  </div>

                  {/* 名称 */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 10,
                        color: "#6b8aaa",
                        marginBottom: 6,
                      }}
                    >
                      显示名称 *
                    </label>
                    <Input
                      value={editingDomain.name}
                      onChange={(e) =>
                        setEditingDomain({ ...editingDomain, name: e.target.value })
                      }
                      placeholder="如: 数据报表服务"
                      style={{
                        background: "#080e16",
                        border: "1px solid #1a2535",
                        color: "#8ab4c8",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 11,
                      }}
                    />
                  </div>

                  {/* 别名 */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 10,
                        color: "#6b8aaa",
                        marginBottom: 6,
                      }}
                    >
                      别名（可选）
                    </label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <Input
                        value={newAlias}
                        onChange={(e) => setNewAlias(e.target.value)}
                        onPressEnter={handleAddAlias}
                        placeholder="添加别名"
                        style={{
                          background: "#080e16",
                          border: "1px solid #1a2535",
                          color: "#8ab4c8",
                          fontFamily: "'IBM Plex Mono'",
                          fontSize: 11,
                          flex: 1,
                        }}
                      />
                      <Button
                        onClick={handleAddAlias}
                        size="small"
                        style={{
                          background: "#1a2535",
                          border: "none",
                          color: "#8ab4c8",
                        }}
                      >
                        添加
                      </Button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {editingDomain.aliases.map((alias) => (
                        <Tag
                          key={alias}
                          closable
                          onClose={() => handleRemoveAlias(alias)}
                          style={{
                            background: "rgba(0,212,255,0.1)",
                            border: "1px solid #00d4ff33",
                            color: "#00d4ff",
                            fontFamily: "'IBM Plex Mono'",
                            fontSize: 10,
                          }}
                        >
                          {alias}
                        </Tag>
                      ))}
                    </div>
                  </div>
                </div>
              </Drawer>
            )}
          </>
        )}
      </Drawer>
    </>
  );
};

export default DomainConfigPanel;
