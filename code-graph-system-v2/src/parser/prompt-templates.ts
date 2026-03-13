export const CODE_ANALYSIS_PROMPT = `You are a code analysis expert. Analyze the following source code and extract a knowledge graph in JSON format.

Extract the following information:
1. **Nodes**: Classes, functions, APIs, database tables, events, topics
2. **Edges**: Relationships like imports, calls, extends, implements, depends_on, reads, writes, produces, consumes

Return ONLY valid JSON in this exact format:
{
  "nodes": [
    {
      "id": "unique-id",
      "type": "Function|Class|API|Database|Table|Event|Topic|Module|File",
      "name": "node-name",
      "properties": {
        "description": "brief description",
        "path": "file-path",
        "line": 123
      }
    }
  ],
  "edges": [
    {
      "from": "source-node-id",
      "to": "target-node-id",
      "type": "imports|calls|extends|implements|depends_on|reads|writes|produces|consumes",
      "properties": {}
    }
  ]
}

Code to analyze:
Language: {{language}}
File: {{filePath}}

\`\`\`{{language}}
{{code}}
\`\`\`

Return ONLY the JSON graph, no explanations.`;

/**
 * Generate analysis prompt for a code chunk
 * @param language - Programming language
 * @param filePath - File path
 * @param code - Source code
 * @returns Formatted prompt
 */
export function generateAnalysisPrompt(
  language: string,
  filePath: string,
  code: string
): string {
  return CODE_ANALYSIS_PROMPT
    .replace(/\{\{language\}\}/g, language)
    .replace(/\{\{filePath\}\}/g, filePath)
    .replace(/\{\{code\}\}/g, code);
}
