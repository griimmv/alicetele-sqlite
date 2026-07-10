import { wikipediaTool, type WikiResult } from "./tools/wikipedia.ts";

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

function extractQuotes(wiki: WikiResult): { text: string; source: string; url: string }[] {
  const sentences = wiki.extract
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 40);

  return sentences.slice(0, 3).map(s => ({
    text: s,
    source: wiki.title,
    url: wiki.url,
  }));
}

export async function runToolMode(
  query: string
): Promise<{ content: string; tokens: TokenUsage }> {
  const raw = await wikipediaTool.func({ query }) as string;
  const wikiData = JSON.parse(raw) as unknown as WikiResult | null;

  if (!wikiData || !wikiData.foundArticle) {
    const notification = wikiData?.notification ?? `No Wikipedia article found for "${query}".`;
    return {
      content: JSON.stringify({
        summary: notification,
        quotes: [],
        sources: [],
      }),
      tokens: { input: 0, output: 0, total: 0 },
    };
  }

  return {
    content: JSON.stringify({
      summary: wikiData.extract,
      quotes: extractQuotes(wikiData),
      sources: [{ title: wikiData.title, url: wikiData.url }],
    }),
    tokens: { input: 0, output: 0, total: 0 },
  };
}
