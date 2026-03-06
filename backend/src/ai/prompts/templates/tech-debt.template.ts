import { FileNode } from '../../../worker/code-analyzer.service';
import { PromptTemplate } from './base.template';

export class TechDebtTemplate extends PromptTemplate {
  render(fileNode: FileNode): string {
    const classesInfo = JSON.stringify(
      fileNode.classes.map((c) => ({
        name: c.name,
        methods: c.methods,
        extends: c.extends,
      })),
    );
    const functionsInfo = JSON.stringify(
      fileNode.functions.map((f) => ({
        name: f.name,
        line: f.line,
      })),
    );

    return `你是一个代码质量专家。请评估以下代码的技术债。

文件路径: ${fileNode.filePath}

代码内容:
\`\`\`
${fileNode.content || '(无法读取文件内容)'}
\`\`\`

代码信息:
- 类: ${classesInfo}
- 函数: ${functionsInfo}

要求:
1. 评估代码质量（0-100 分，100 分最好）
2. 识别技术债项（代码重复、过长函数、过大类、缺少测试等）
3. 为每个技术债项评估优先级：low, medium, high
4. 估算修复工作量：small（<1天）, medium（1-3天）, large（>3天）

**重要：你必须返回有效的 JSON 格式，不要返回任何其他文本。**

返回格式（必须是有效的 JSON）:
{
  "qualityScore": 75,
  "techDebts": [
    {
      "type": "code_duplication|long_function|large_class|missing_tests|poor_naming",
      "priority": "low|medium|high",
      "description": "技术债描述",
      "location": "代码位置",
      "estimatedEffort": "small|medium|large",
      "suggestion": "重构建议"
    }
  ]
}`;
  }
}
