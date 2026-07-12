import { tool } from "@langchain/core/tools";
import { z } from "zod";

const SEARCH_TIMEOUT = 15000;

export interface StackExchangeItem {
  title: string;
  url: string;
  score: number;
}

export interface StackExchangeResult {
  items: StackExchangeItem[];
  found: boolean;
  notification?: string;
}

async function searchStackOverflow(query: string): Promise<StackExchangeResult> {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=3`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Stack Exchange API returned ${response.status}: ${response.statusText}`);
    }
    const data = await response.json() as {
      items?: { title: string; link: string; score: number }[];
    };

    if (!data.items || data.items.length === 0) {
      return {
        items: [],
        found: false,
        notification: `No Stack Overflow results found for "${query}".`,
      };
    }

    return {
      items: data.items.map(item => ({
        title: item.title,
        url: item.link,
        score: item.score,
      })),
      found: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return {
      items: [],
      found: false,
      notification: `Stack Overflow search failed: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const stackoverflowTool = tool(
  async (input: { query: string }): Promise<string> => {
    const result = await searchStackOverflow(input.query);
    return JSON.stringify(result);
  },
  {
    name: "stackoverflow",
    description:
      "Search Stack Overflow for programming questions and answers. Use this when the user asks about coding problems, errors, debugging, or technical questions about software development.",
    schema: z.object({
      query: z.string().describe("The programming question or topic to search for on Stack Overflow"),
    }),
  }
);
