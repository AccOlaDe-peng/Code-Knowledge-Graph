import OpenAI from 'openai';
import { BaseModelAdapter, ChatResponse } from './base-model.adapter';

export class MiniMaxAdapter extends BaseModelAdapter {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, baseUrl || 'https://api.minimax.chat/v1');
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
  }

  async chat(prompt: string, modelName: string): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      content: response.choices[0].message.content ?? '',
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
