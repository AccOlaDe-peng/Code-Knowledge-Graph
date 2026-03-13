import { z } from 'zod';
import { Node, Edge, NodeType, EdgeType } from '../types/graph';

// Zod schemas for validation
const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  properties: z.record(z.any()),
});

const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  properties: z.record(z.any()),
});

const GraphResponseSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export type GraphResponse = z.infer<typeof GraphResponseSchema>;

/**
 * Validate and parse JSON graph response from LLM
 * @param jsonString - JSON string from LLM
 * @returns Validated graph response
 */
export function validateGraphResponse(jsonString: string): GraphResponse {
  try {
    // Parse JSON
    const parsed = JSON.parse(jsonString);

    // Validate with Zod
    const validated = GraphResponseSchema.parse(parsed);

    return validated;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Graph validation failed: ${error.message}`);
    }
    throw new Error(`Invalid JSON: ${error}`);
  }
}

/**
 * Extract JSON from LLM response (handles markdown code blocks)
 * @param response - LLM response text
 * @returns Extracted JSON string
 */
export function extractJSON(response: string): string {
  // Try to extract JSON from markdown code block
  const codeBlockMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object directly
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Return as-is if no pattern matched
  return response.trim();
}
