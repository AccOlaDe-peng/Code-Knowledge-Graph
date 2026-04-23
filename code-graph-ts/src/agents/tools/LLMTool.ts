// LLMTool — Anthropic SDK wrapper for semantic analysis

import { createTool, type ToolResult } from './common.ts';
import type { Tool } from '../BaseAgent.ts';

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

// Tool for single-shot LLM completion
function createLLMTool(): Tool {
  return createTool<{ prompt: string; config?: LLMConfig }, LLMResponse>(
    'LLMTool',
    async ({ prompt, config }) => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'ANTHROPIC_API_KEY not set' };
      }

      const model = config?.model ?? 'sonnet';
      const modelId = `claude-${model === 'opus' ? 'opus-4-7' : model === 'sonnet' ? 'sonnet-4-6' : 'haiku-4-5'}-20250514`;

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: config?.maxTokens ?? 4096,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          return { success: false, error: `LLM API error: ${response.status} ${error}` };
        }

        const data = await response.json() as {
          content: Array<{ type: string; text?: string }>;
          usage: { input_tokens: number; output_tokens: number };
        };

        const textContent = data.content.find(c => c.type === 'text')?.text ?? '';
        const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

        return {
          success: true,
          data: {
            content: textContent,
            tokensUsed,
            model: modelId,
          },
        };
      } catch (error) {
        return { success: false, error: `LLM request failed: ${error}` };
      }
    },
  );
}

// Tool for reading file content (LLM needs this as a tool)
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
