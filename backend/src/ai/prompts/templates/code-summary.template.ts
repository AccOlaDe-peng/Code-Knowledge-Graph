import { FileNode } from '../../../worker/code-analyzer.service';
import { PromptTemplate } from './base.template';

export class CodeSummaryTemplate extends PromptTemplate {
  render(fileNode: FileNode): string {
    const classes = fileNode.classes.map((c) => c.name).join(', ') || '无';
    const functions = fileNode.functions.map((f) => f.name).join(', ') || '无';
    const imports = fileNode.imports.join(', ') || '无';

    return `你是一个高级软件架构师。请分析以下代码并返回结构化 JSON。

文件路径: ${fileNode.filePath}

代码内容:
\`\`\`
${fileNode.content || '(无法读取文件内容)'}
\`\`\`

代码结构:
- 类: ${classes}
- 函数: ${functions}
- 导入: ${imports}

要求:
1. 总结代码的核心功能（50 字以内）
2. 识别主要的业务逻辑
3. 列出关键的类和函数及其职责
4. 分析代码的设计模式（如果有）

**重要：你必须返回有效的 JSON 格式，不要返回任何其他文本。**

返回格式（必须是有效的 JSON）:
{
  "summary": "代码功能总结",
  "businessLogic": "业务逻辑描述",
  "keyComponents": [
    {
      "name": "组件名称",
      "type": "class|function",
      "responsibility": "职责描述"
    }
  ],
  "designPatterns": ["设计模式1", "设计模式2"]
}`;
  }
}
