import { BaseModelAdapter, ChatResponse } from './base-model.adapter';

// GLM（智谱 AI）适配器
// 参考：https://open.bigmodel.cn/dev/api
export class GLMAdapter extends BaseModelAdapter {
  constructor(apiKey: string) {
    super(apiKey, 'https://open.bigmodel.cn/api/paas/v4');
  }

  async chat(prompt: string, modelName: string): Promise<ChatResponse> {
    // GLM API 实现
    // 这里提供基础结构，实际实现需要根据 GLM API 文档调整
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`GLM API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    };
  }
}
