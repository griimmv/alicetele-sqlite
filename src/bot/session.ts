import { getSessionTurns } from "../db/indexdb.ts";
import type { TurnRow } from "../db/indexdb.ts";

export async function loadConversationHistory(
  sessionId: number,
  fromIndex?: number
): Promise<any[]> {
  const turns = await getSessionTurns(sessionId, fromIndex);
  const messages: any[] = [];

  for (const turn of turns) {
    messages.push({ role: "user", content: turn.query });
    if (turn.raw) {
      messages.push({ role: "assistant", content: turn.raw });
    } else if (turn.summary) {
      const content: Record<string, unknown> = { summary: turn.summary };
      if (turn.quotes) {
        try { content.quotes = JSON.parse(turn.quotes); } catch { content.quotes = []; }
      }
      if (turn.sources) {
        try { content.sources = JSON.parse(turn.sources); } catch { content.sources = []; }
      }
      messages.push({ role: "assistant", content: JSON.stringify(content) });
    }
  }

  return messages;
}

export function buildExportData(
  session: { id: number; name: string; created_at: string },
  turns: TurnRow[]
): Record<string, unknown> {
  return {
    session: {
      name: session.name,
      created_at: session.created_at,
    },
    turns: turns.map((turn) => ({
      query: turn.query,
      summary: turn.summary,
      quotes: parseJSON(turn.quotes),
      sources: parseJSON(turn.sources),
      tokens: { input: turn.input_tokens, output: turn.output_tokens },
    })),
  };
}

function parseJSON(str: string | null): unknown {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}


