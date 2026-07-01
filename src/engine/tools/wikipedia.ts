import wiki from "wikipedia";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const MAX_CONTENT_CHARS = 8000;
const WIKI_TIMEOUT = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

export interface WikiResult {
  title: string;
  url: string;
  extract: string;
  fullContent?: string;
  thumbnail?: string;
  notification?: string;
  foundArticle: boolean;
}

async function fetchPage(input: string): Promise<WikiResult> {
  const page = await withTimeout(wiki.page(input, { preload: true }), WIKI_TIMEOUT, `wiki.page("${input}")`);
  const [pageSummary, content] = await Promise.all([
    withTimeout(page.summary(), WIKI_TIMEOUT, `page.summary()`),
    withTimeout(page.content(), WIKI_TIMEOUT, `page.content()`),
  ]);

  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(pageSummary.title.replace(/ /g, '_'))}`;
  const suffix = "\n\n[...content truncated]";
  const truncated = content.length > MAX_CONTENT_CHARS
    ? content.slice(0, MAX_CONTENT_CHARS - suffix.length) + suffix
    : content;

  return {
    title: pageSummary.title,
    url,
    extract: pageSummary.extract,
    fullContent: truncated,
    thumbnail: pageSummary.thumbnail?.source,
    foundArticle: true,
  };
}

export const wikipediaTool = tool(
  async (input: { query: string }): Promise<string> => {
    const topic = input.query;
    try {
      const result = await fetchPage(topic);
      return JSON.stringify(result);
    } catch (error) {
      try {
        const searchResults = await withTimeout(wiki.search(topic, { limit: 1 }), WIKI_TIMEOUT, `wiki.search("${topic}")`);
        if (searchResults.results.length === 0) {
          return JSON.stringify({ title: "", url: "", extract: "", fullContent: "", thumbnail: "", foundArticle: false, notification: `No Wikipedia article found for "${topic}"` });
        }
        const result = await fetchPage(searchResults.results[0].title);
        result.notification = "  (No title matched the query, using fuzzy finder option that might be inaccurate)";
        return JSON.stringify(result);
      } catch (searchError) {
        const msg = searchError instanceof Error ? searchError.message : "Unknown error";
        const notification = msg.includes("timed out")
          ? `Wikipedia search timed out for "${topic}". Please try again.`
          : `Wikipedia search failed for "${topic}": ${msg}`;
        return JSON.stringify({ title: "", url: "", extract: "", fullContent: "", thumbnail: "", foundArticle: false, notification });
      }
    }
  },
  {
    name: "wikipedia",
    description:
      "A Wikipedia search tool. Use this when the user asks about factual information, people, places, history, or any topic that can be found on Wikipedia. Input should be a search query or topic name.",
    schema: z.object({
      query: z.string().describe("The topic to search for on Wikipedia"),
    }),
  }
);
