import axios, { AxiosInstance } from 'axios';
import { generateAnalysisPrompt } from './prompt-templates';
import { validateGraphResponse, extractJSON, GraphResponse } from './json-validator';

export interface AIClientConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

export class AIClient {
  private client: AxiosInstance;
  private config: Required<AIClientConfig>;

  constructor(config: AIClientConfig) {
    this.config = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model || (config.provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4-turbo'),
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.1,
      timeout: config.timeout || 30000,
    };

    this.client = axios.create({
      timeout: this.config.timeout,
    });
  }

  /**
   * Call Anthropic Claude API
   */
  private async callAnthropic(prompt: string): Promise<string> {
    const response = await this.client.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    return response.data.content[0].text;
  }

  /**
   * Call OpenAI GPT API
   */
  private async callOpenAI(prompt: string): Promise<string> {
    const response = await this.client.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      }
    );

    return response.data.choices[0].message.content;
  }

  /**
   * Analyze code and return graph
   * @param language - Programming language
   * @param filePath - File path
   * @param code - Source code
   * @param retries - Number of retries on failure
   * @returns Graph response
   */
  async analyzeCode(
    language: string,
    filePath: string,
    code: string,
    retries = 3
  ): Promise<GraphResponse> {
    const prompt = generateAnalysisPrompt(language, filePath, code);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Analyzing ${filePath} (attempt ${attempt}/${retries})...`);

        // Call LLM
        const response = this.config.provider === 'anthropic'
          ? await this.callAnthropic(prompt)
          : await this.callOpenAI(prompt);

        // Extract and validate JSON
        const jsonString = extractJSON(response);
        const graph = validateGraphResponse(jsonString);

        console.log(`✓ Successfully analyzed ${filePath}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

        return graph;
      } catch (error) {
        console.error(`✗ Attempt ${attempt} failed for ${filePath}:`, error);

        if (attempt === retries) {
          throw new Error(`Failed to analyze ${filePath} after ${retries} attempts: ${error}`);
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    throw new Error('Unexpected error in analyzeCode');
  }
}

/**
 * Create AI client from environment variables
 */
export function createAIClient(): AIClient {
  const provider = (process.env.LLM_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
  const apiKey = provider === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  return new AIClient({
    provider,
    apiKey,
    model: process.env.AI_MODEL,
    maxTokens: process.env.AI_MAX_TOKENS ? parseInt(process.env.AI_MAX_TOKENS) : undefined,
    temperature: process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : undefined,
  });
}
