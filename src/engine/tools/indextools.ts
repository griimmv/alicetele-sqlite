import { wikipediaTool, type WikiResult } from "./wikipedia.ts";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { parseJSONFromText } from "../parser.ts";

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
      const data = parseJSONFromText(raw) as unknown as WikiResult | null;
      if (!data?.foundArticle) {
        return {
          summary: data.notification ?? `No Wikipedia article found for "${query}".`,
          quotes: [],
          sources: [],
        };
      }
      const sentences = data.extract
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length > 40);
      return {
        summary: data.extract,
        quotes: sentences.slice(0, 3).map(sentence => ({
          text: sentence,
          source: data.title,
          url: data.url,
        })),
        sources: [{ title: data.title, url: data.url }],
      };
    },
  },
];

export function getToolEntry(name: string): ToolEntry | undefined {
  return toolRegistry.find(entry => entry.tool.name === name);
}
