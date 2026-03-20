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
} from "@ant-design/icons";
import { LANGS } from "../constants";
import type { RepoInfo } from "../../../types/api";

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
      onOk={() => void form.submit()}
      okText={isEditMode ? "保存修改" : "保存仓库"}
      cancelText="取消"
      title={isEditMode ? `编辑仓库: ${editRepo?.repoName}` : "添加仓库"}
      confirmLoading={loading}
    >
      {!isEditMode && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Button
            type={sourceMode === "git" ? "primary" : "default"}
            icon={<GithubOutlined />}
            onClick={() => {
              setSourceMode("git");
              form.resetFields();
            }}
          >
            Git 仓库
          </Button>
          <Button
            type={sourceMode === "local" ? "primary" : "default"}
            icon={<FolderOutlined />}
            onClick={() => {
              setSourceMode("local");
              form.resetFields();
            }}
          >
            本地路径
          </Button>
        </div>
      )}

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
              label="Git 仓库地址"
              rules={
                isEditMode
                  ? []
                  : [{ required: true, message: "Git URL 不能为空" }]
              }
            >
              <Input placeholder="git@github.com:org/repo.git 或 https://github.com/org/repo.git" />
            </Form.Item>
            <Form.Item name="branch" label="分支（可选）">
              <Input placeholder="main / master / feature/xxx" />
            </Form.Item>
          </>
        )}

        {sourceMode === "local" && (
          <Form.Item
            name="repoPath"
            label="本地仓库路径"
            rules={
              isEditMode
                ? []
                : [{ required: true, message: "路径不能为空" }]
            }
          >
            <Input placeholder="C:/path/to/repo" />
          </Form.Item>
        )}

        <Form.Item name="repoName" label="仓库名称（可选）">
          <Input placeholder="默认自动推断" />
        </Form.Item>

        <Form.Item name="languages" label="编程语言（可选）">
          <Select
            mode="multiple"
            placeholder="不选则分析时自动检测"
            options={LANGS.map((lang) => ({ value: lang, label: lang }))}
          />
        </Form.Item>

        {submitError && (
          <Alert
            type="error"
            message="保存失败"
            description={submitError}
            showIcon
          />
        )}
      </Form>
    </Modal>
  );
};

export type { RepoFormValues };
