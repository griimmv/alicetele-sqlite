import { toolRegistry } from "./tools/indextools.ts";

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export async function runToolMode(
  query: string,
  toolName: string
): Promise<{ content: string; tokens: TokenUsage }> {
  const entry = toolRegistry.find(e => e.tool.name === toolName);
  if (!entry) throw new Error(`Unknown tool: ${toolName}`);

  const raw = await entry.tool.func({ query }) as string;
  const output = entry.formatOutput(raw, query);

  return {
    content: JSON.stringify(output),
    tokens: { input: 0, output: 0, total: 0 },
  };
}
