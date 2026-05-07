// LLMTool — Multi-provider LLM wrapper (Anthropic / DeepSeek / OpenAI-compatible)

import { createTool, type ToolResult } from './common.ts';
import type { Tool } from '../BaseAgent.ts';
import { AgentError, ErrorCode } from '../../errors/index.ts';

type Provider = 'anthropic' | 'deepseek' | 'openai-compatible';

interface LLMConfig {
  model: 'opus' | 'sonnet' | 'haiku';
  maxTokens?: number;
  temperature?: number;
}

interface LLMResponse {
  content: string;
  tokensUsed: number;
  model: string;
}

const MODEL_MAP: Record<Provider, Record<string, string>> = {
  anthropic: {
    opus: 'claude-opus-4-7-20250514',
    sonnet: 'claude-sonnet-4-6-20250514',
    haiku: 'claude-haiku-4-5-20250514',
  },
  deepseek: {
    opus: 'deepseek-reasoner',
    sonnet: 'deepseek-chat',
    haiku: 'deepseek-chat',
  },
  'openai-compatible': {
    opus: 'gpt-4o',
    sonnet: 'gpt-4o-mini',
    haiku: 'gpt-4o-mini',
  },
};

function detectProvider(): Provider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === 'deepseek' || explicit === 'anthropic' || explicit === 'openai-compatible') {
    return explicit;
  }
  const baseUrl = process.env.LLM_BASE_URL ?? '';
  if (baseUrl.includes('deepseek')) return 'deepseek';
  if (baseUrl.includes('openai')) return 'openai-compatible';
  // If LLM_BASE_URL is set but unrecognized, treat as OpenAI-compatible
  if (baseUrl) return 'openai-compatible';
  return 'anthropic';
}

function getApiKey(provider: Provider): string | undefined {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY;
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  // For other providers, try common env vars
  return process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
}

function getEndpoint(provider: Provider): string {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/+$/, '');
  if (baseUrl) {
    // If base URL already includes /v1, don't add it again; otherwise add /v1/chat/completions
    if (baseUrl.endsWith('/v1')) return `${baseUrl}/chat/completions`;
    return `${baseUrl}/v1/chat/completions`;
  }
  switch (provider) {
    case 'deepseek': return 'https://api.deepseek.com/v1/chat/completions';
    case 'openai-compatible': return 'https://api.openai.com/v1/chat/completions';
    default: return 'https://api.anthropic.com/v1/messages';
  }
}

function mapModel(tier: string, provider: Provider): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  return MODEL_MAP[provider]?.[tier] ?? tier;
}

function buildAnthropicRequest(modelId: string, prompt: string, config?: LLMConfig) {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey('anthropic') ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: config?.maxTokens ?? 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  };
}

function buildOpenAICompatibleRequest(endpoint: string, modelId: string, prompt: string, config?: LLMConfig) {
  const provider = detectProvider();
  return {
    url: endpoint,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey(provider) ?? ''}`,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: config?.maxTokens ?? 4096,
      temperature: config?.temperature ?? 0.7,
      messages: [{ role: 'user', content: prompt }],
    }),
  };
}

function parseAnthropicResponse(data: any): { content: string; tokensUsed: number } {
  const textContent = data.content?.find((c: any) => c.type === 'text')?.text ?? '';
  const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
  return { content: textContent, tokensUsed };
}

function parseOpenAICompatibleResponse(data: any): { content: string; tokensUsed: number } {
  const textContent = data.choices?.[0]?.message?.content ?? '';
  const tokensUsed = data.usage?.total_tokens ?? 0;
  return { content: textContent, tokensUsed };
}

function createLLMTool(): Tool {
  return createTool<{ prompt: string; config?: LLMConfig }, LLMResponse>(
    'LLMTool',
    async ({ prompt, config }) => {
      const provider = detectProvider();
      const apiKey = getApiKey(provider);
      if (!apiKey) {
        return { success: false, error: `LLM API key not set (provider: ${provider}). Set LLM_API_KEY or ANTHROPIC_API_KEY.` };
      }

      const tier = config?.model ?? 'sonnet';
      const modelId = mapModel(tier, provider);

      try {
        const isAnthropic = provider === 'anthropic' && !process.env.LLM_BASE_URL;
        const endpoint = getEndpoint(provider);

        const { url, headers, body } = isAnthropic
          ? buildAnthropicRequest(modelId, prompt, config)
          : buildOpenAICompatibleRequest(endpoint, modelId, prompt, config);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const errorMsg = `LLM API error (${provider}): ${response.status} ${errorText}`;
          // Auth errors are recoverable — pipeline can fall back to static-only
          if (response.status === 401 || response.status === 403) {
            throw new AgentError(ErrorCode.LLM_API_ERROR, 'LLMTool', true, { status: response.status, provider });
          }
          // Rate limit is recoverable
          if (response.status === 429) {
            throw new AgentError(ErrorCode.LLM_RATE_LIMIT, 'LLMTool', true);
          }
          return { success: false, error: errorMsg };
        }

        const data = await response.json();
        const { content, tokensUsed } = isAnthropic
          ? parseAnthropicResponse(data)
          : parseOpenAICompatibleResponse(data);

        return {
          success: true,
          data: { content, tokensUsed, model: modelId },
        };
      } catch (error) {
        // Re-throw recoverable errors so they propagate to the pipeline
        if (error instanceof AgentError) throw error;
        return { success: false, error: `LLM request failed: ${error}` };
      }
    },
  );
}

// Tool for reading file content
function createReadFileTool(): Tool {
  return createTool<string, string>('ReadFileTool', async (filePath: string) => {
    try {
      const content = await Bun.file(filePath).text();
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: `Failed to read ${filePath}: ${error}` };
    }
  });
}

// Tool for searching code patterns
function createSearchCodeTool(): Tool {
  return createTool<{ pattern: string; directory: string }, string[]>(
    'SearchCodeTool',
    async ({ pattern, directory }) => {
      try {
        const proc = Bun.spawn(['grep', '-r', '-l', pattern, directory], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const stdout = await new Response(proc.stdout).text();
        await proc.exited;
        return {
          success: true,
          data: stdout.trim().split('\n').filter(Boolean),
        };
      } catch {
        return { success: true, data: [] };
      }
    },
  );
}

export type { LLMConfig, LLMResponse };
export { createLLMTool, createReadFileTool, createSearchCodeTool };
