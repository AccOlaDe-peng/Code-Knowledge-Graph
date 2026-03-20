import type { AnalysisDepth } from "../../types/api";

export const LANGS = [
  "python",
  "typescript",
  "javascript",
  "java",
  "go",
  "rust",
  "cpp",
  "csharp",
];

export const DEPTH_OPTIONS: {
  value: AnalysisDepth;
  label: string;
  description: string;
}[] = [
  {
    value: "quick",
    label: "快速分析",
    description: "仅扫描核心文件，快速识别模块边界",
  },
  {
    value: "standard",
    label: "标准分析",
    description: "完整扫描，AI 深度分析代码结构",
  },
  {
    value: "deep",
    label: "深度分析",
    description: "全量分析，包含数据血缘与跨模块依赖",
  },
];
