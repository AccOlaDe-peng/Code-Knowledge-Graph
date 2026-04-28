import React, { useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
} from "antd";
import {
  FolderOutlined,
  GithubOutlined,
  GlobalOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import type { RepoInfo } from "../../../types/api";

const LANGS = [
  "python",
  "typescript",
  "javascript",
  "java",
  "go",
  "rust",
  "cpp",
  "csharp",
];

type SourceMode = "local" | "git";

type RepoFormValues = {
  repoPath?: string;
  gitUrl?: string;
  repoName?: string;
  branch?: string;
  languages?: string[];
  sourceMode?: "local" | "git";
};

interface AddRepoModalProps {
  open: boolean;
  editRepo?: RepoInfo | null;
  onClose: () => void;
  onSubmit: (values: RepoFormValues, mode: "create" | "edit") => Promise<void>;
  existingPaths: string[];
}

export const AddRepoModal: React.FC<AddRepoModalProps> = ({
  open,
  editRepo,
  onClose,
  onSubmit,
  existingPaths,
}) => {
  const [form] = Form.useForm<RepoFormValues>();
  const [sourceMode, setSourceMode] = useState<SourceMode>("git");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEditMode = !!editRepo;

  // 当 modal 打开时，根据 editRepo 初始化表单
  React.useEffect(() => {
    if (open && editRepo) {
      form.setFieldsValue({
        repoName: editRepo.repoName,
        branch: editRepo.branch,
        languages: editRepo.language,
        gitUrl: editRepo.sourceMode === "git" ? editRepo.repoPath : undefined,
        repoPath: editRepo.sourceMode === "local" ? editRepo.repoPath : undefined,
      });
      setSourceMode(editRepo.sourceMode === "local" ? "local" : "git");
    } else if (open) {
      form.resetFields();
      setSourceMode("git");
    }
    setSubmitError(null);
  }, [open, editRepo, form]);

  const handleSubmit = async (values: RepoFormValues) => {
    setSubmitError(null);
    setLoading(true);

    const valuesWithMode = { ...values, sourceMode };
    const repoPath = sourceMode === "git" ? values.gitUrl : values.repoPath;

    if (!isEditMode && repoPath) {
      // 创建模式下检查重复路径
      if (existingPaths.includes(repoPath)) {
        setSubmitError(`仓库路径已存在`);
        setLoading(false);
        return;
      }
    }

    try {
      await onSubmit(valuesWithMode, isEditMode ? "edit" : "create");
      onClose();
      form.resetFields();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    form.resetFields();
    setSubmitError(null);
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      title={null}
      closable={false}
      width={520}
    >
      {/* Header */}
      <div
        style={{
          padding: "24px 28px 20px",
          borderBottom: "1px solid var(--b-faint)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--t-primary)",
            marginBottom: 4,
          }}
        >
          {isEditMode ? `编辑仓库` : "添加仓库"}
        </h2>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--t-muted)",
          }}
        >
          {isEditMode
            ? `修改 ${editRepo?.repoName} 的配置`
            : "添加一个新的代码仓库进行知识图谱分析"}
        </p>
      </div>

      {/* Source Mode Selector */}
      {!isEditMode && (
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "20px 28px 0",
          }}
        >
          <SourceModeButton
            active={sourceMode === "git"}
            icon={<GithubOutlined style={{ fontSize: 16 }} />}
            label="Git 仓库"
            description="从 Git URL 克隆"
            onClick={() => {
              setSourceMode("git");
              form.resetFields();
            }}
          />
          <SourceModeButton
            active={sourceMode === "local"}
            icon={<FolderOutlined style={{ fontSize: 16 }} />}
            label="本地路径"
            description="直接分析本地目录"
            onClick={() => {
              setSourceMode("local");
              form.resetFields();
            }}
          />
        </div>
      )}

      {/* Form */}
      <div style={{ padding: "20px 28px" }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          {sourceMode === "git" && (
            <>
              <Form.Item
                name="gitUrl"
                label={
                  <LabelWithIcon
                    icon={<LinkOutlined />}
                    text="Git 仓库地址"
                  />
                }
                rules={
                  isEditMode
                    ? []
                    : [{ required: true, message: "Git URL 不能为空" }]
                }
              >
                <Input
                  placeholder="git@github.com:org/repo.git 或 https://github.com/org/repo.git"
                  style={{ height: 40, borderRadius: 6 }}
                />
              </Form.Item>
              <Form.Item
                name="branch"
                label={
                  <LabelWithIcon
                    icon={<GlobalOutlined />}
                    text="分支（可选）"
                  />
                }
              >
                <Input
                  placeholder="main / master / feature/xxx"
                  style={{ height: 40, borderRadius: 6 }}
                />
              </Form.Item>
            </>
          )}

          {sourceMode === "local" && (
            <Form.Item
              name="repoPath"
              label={
                <LabelWithIcon
                  icon={<FolderOutlined />}
                  text="本地仓库路径"
                />
              }
              rules={
                isEditMode
                  ? []
                  : [{ required: true, message: "路径不能为空" }]
              }
            >
              <Input
                placeholder="C:/path/to/repo 或 /home/user/repo"
                style={{ height: 40, borderRadius: 6 }}
              />
            </Form.Item>
          )}

          <Form.Item
            name="repoName"
            label={
              <LabelWithIcon text="仓库名称（可选）" />
            }
          >
            <Input
              placeholder="默认自动从路径推断"
              style={{ height: 40, borderRadius: 6 }}
            />
          </Form.Item>

          <Form.Item
            name="languages"
            label={
              <LabelWithIcon text="编程语言（可选）" />
            }
          >
            <Select
              mode="multiple"
              placeholder="不选则分析时自动检测"
              options={LANGS.map((lang) => ({ value: lang, label: lang }))}
              style={{ borderRadius: 6 }}
            />
          </Form.Item>

          {submitError && (
            <Alert
              type="error"
              message="保存失败"
              description={submitError}
              showIcon
              style={{ borderRadius: 6, marginTop: 8 }}
            />
          )}
        </Form>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          padding: "16px 28px 24px",
          borderTop: "1px solid var(--b-faint)",
        }}
      >
        <Button
          onClick={handleClose}
          style={{
            height: 40,
            borderRadius: 6,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
          }}
        >
          取消
        </Button>
        <Button
          type="primary"
          loading={loading}
          onClick={() => void form.submit()}
          style={{
            height: 40,
            borderRadius: 6,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            minWidth: 100,
          }}
        >
          {isEditMode ? "保存修改" : "添加仓库"}
        </Button>
      </div>
    </Modal>
  );
};

// Source Mode Button Component
const SourceModeButton: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}> = ({ active, icon, label, description, onClick }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 16px",
      background: active ? "rgba(0,212,255,0.08)" : "var(--s-float)",
      border: active ? "1px solid rgba(0,212,255,0.3)" : "1px solid var(--b-faint)",
      borderRadius: 8,
      cursor: "pointer",
      transition: "all 0.15s var(--ease-out)",
      textAlign: "left",
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "rgba(0,212,255,0.12)" : "var(--s-overlay)",
        borderRadius: 6,
        color: active ? "var(--t-cyan)" : "var(--t-secondary)",
      }}
    >
      {icon}
    </div>
    <div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          fontWeight: 500,
          color: active ? "var(--t-cyan)" : "var(--t-primary)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          color: "var(--t-muted)",
        }}
      >
        {description}
      </div>
    </div>
  </button>
);

// Label with Icon Component
const LabelWithIcon: React.FC<{
  text: string;
  icon?: React.ReactNode;
}> = ({ text, icon }) => (
  <span
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-ui)",
      fontSize: 12,
      fontWeight: 500,
      color: "var(--t-secondary)",
    }}
  >
    {icon && <span style={{ opacity: 0.7 }}>{icon}</span>}
    {text}
  </span>
);

export type { RepoFormValues };
