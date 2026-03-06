import { OpenAIAdapter } from './openai.adapter';

// DeepSeek 使用 OpenAI 兼容接口
export class DeepSeekAdapter extends OpenAIAdapter {
  constructor(apiKey: string) {
    super(apiKey, 'https://api.deepseek.com/v1');
  }
}
