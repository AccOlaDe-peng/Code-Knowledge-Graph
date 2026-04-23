// Tool interface and base implementations

import type { Tool } from '../BaseAgent.ts';

// Standard tool result
interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Create a tool factory — accepts single arg (object or primitive)
function createTool<TInput, TResult>(
  name: string,
  executor: (input: TInput) => Promise<ToolResult<TResult>>,
): Tool {
  return {
    name,
    execute: async (...args: unknown[]) => {
      // Unwrap single-arg calls; pass first arg as input
      const input = args[0] as TInput;
      const result = await executor(input);
      if (!result.success) {
        throw new Error(result.error ?? `Tool '${name}' failed`);
      }
      return result.data;
    },
  };
}

export type { ToolResult };
export { createTool };
