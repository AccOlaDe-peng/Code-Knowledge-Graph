import Anthropic from '@anthropic-ai/sdk';
import { BaseModelAdapter, ChatResponse } from './base-model.adapter';

export class ClaudeAdapter extends BaseModelAdapter {
  private client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, baseUrl || 'https://api.anthropic.com');
    this.client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
  }

  async chat(prompt: string, modelName: string): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: modelName,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return {
      content,
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };
  }
}
