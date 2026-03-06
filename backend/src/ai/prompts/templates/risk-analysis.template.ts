import { FileNode } from '../../../worker/code-analyzer.service';
import { PromptTemplate } from './base.template';

export class RiskAnalysisTemplate extends PromptTemplate {
  render(fileNode: FileNode): string {
    const classesInfo = JSON.stringify(
      fileNode.classes.map((c) => ({
        name: c.name,
        methods: c.methods,
      })),
    );
    const functionsInfo = JSON.stringify(
      fileNode.functions.map((f) => ({
        name: f.name,
        calls: f.calls,
      })),
    );

    return `你是一个代码安全专家。请分析以下代码的潜在风险。

文件路径: ${fileNode.filePath}

代码内容:
\`\`\`
${fileNode.content || '(无法读取文件内容)'}
\`\`\`

代码信息:
- 类: ${classesInfo}
- 函数: ${functionsInfo}

要求:
1. 识别安全风险（SQL 注入、XSS、敏感信息泄露等）
2. 识别性能风险（循环依赖、内存泄漏、低效算法等）
3. 识别可维护性风险（代码复杂度、缺少注释、命名不规范等）
4. 为每个风险评估严重程度：low, medium, high, critical

**重要：你必须返回有效的 JSON 格式，不要返回任何其他文本。**

返回格式（必须是有效的 JSON）:
{
  "overallRiskLevel": "low|medium|high|critical",
  "risks": [
    {
      "type": "security|performance|maintainability",
      "severity": "low|medium|high|critical",
      "description": "风险描述",
      "location": "代码位置（类名/函数名）",
      "suggestion": "修复建议"
    }
  ]
}`;
  }
}
