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
  const found = toolRegistry.find(entry => entry.tool.name === toolName);
  if (!found) throw new Error(`Unknown tool: ${toolName}`);

  const raw = await (found.tool as any).func({ query }) as string;
  const output = found.formatOutput(raw, query);

  return {
    content: JSON.stringify(output),
    tokens: { input: 0, output: 0, total: 0 },
  };
}
