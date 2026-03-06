export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export abstract class BaseModelAdapter {
  protected apiKey: string;
  protected baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  abstract chat(
    prompt: string,
    modelName: string,
    options?: any,
  ): Promise<ChatResponse>;
}
