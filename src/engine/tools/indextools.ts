import { wikipediaTool, type WikiResult } from "./wikipedia.ts";
import type { StructuredToolInterface } from "@langchain/core/tools";

export interface ToolOutput {
  summary: string;
  quotes: { text: string; source: string; url: string }[];
  sources: { title: string; url: string }[];
}

export interface ToolEntry {
  tool: StructuredToolInterface;
  formatOutput(raw: string, query: string): ToolOutput;
}

export const toolRegistry: ToolEntry[] = [
  {
    tool: wikipediaTool,
    formatOutput(raw, query) {
      const data = JSON.parse(raw) as WikiResult;
      if (!data.foundArticle) {
        return {
          summary: data.notification ?? `No Wikipedia article found for "${query}".`,
          quotes: [],
          sources: [],
        };
      }
      const sentences = data.extract
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 40);
      return {
        summary: data.extract,
        quotes: sentences.slice(0, 3).map(s => ({
          text: s,
          source: data.title,
          url: data.url,
        })),
        sources: [{ title: data.title, url: data.url }],
      };
    },
  },
];

export function getToolEntry(name: string): ToolEntry | undefined {
  return toolRegistry.find(e => e.tool.name === name);
}
