import { Bot, InputFile } from "grammy";
import { createAgent, runAgent } from "../engine/agent.ts";
import { createLLM } from "../engine/llm.ts";
import { getOrCreateSession, archiveSession, getSessionTurns, saveTurn } from "../db/index.ts";
import { loadConversationHistory, buildExportData, findTurnByQuery } from "./session.ts";

interface ParsedResponse {
  summary?: string;
  quotes?: { text: string; source: string; url: string }[];
  sources?: { title: string; url: string }[];
}

let agent: ReturnType<typeof createAgent> | null = null;

function getAgent() {
  if (!agent) {
    const llm = createLLM();
    agent = createAgent(llm);
  }
  return agent;
}

export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to AliceWiki! I can fetch Wikipedia articles and answer questions.\n\n"
      + "Send me any topic and I'll look it up. Use /help for commands."
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "/help - Show this message\n"
      + "/end - End current session and start fresh\n"
      + "/export - Export session as JSON file\n"
      + "  Reply to a message with /export to export from that point"
    );
  });

  bot.command("end", async (ctx) => {
    const chatId = ctx.chat.id;
    const session = await archiveSession(chatId);
    await ctx.reply(`Session ended. New session "${session.name}" started.`);
  });

  bot.command("export", async (ctx) => {
    const chatId = ctx.chat.id;
    const session = await getOrCreateSession(chatId);
    let fromIndex: number | undefined;

    // Check if replying to a message
    const replyTo = ctx.message?.reply_to_message;
    if (replyTo && "text" in replyTo && replyTo.text) {
      const turns = await getSessionTurns(session.id);
      const idx = findTurnByQuery(turns, replyTo.text);
      if (idx !== null) {
        fromIndex = idx;
      }
    } else {
      // Check for argument (number or quoted text)
      const arg = ctx.match?.trim();
      if (arg) {
        const num = Number(arg);
        if (!isNaN(num)) {
          fromIndex = num;
        } else {
          const turns = await getSessionTurns(session.id);
          const idx = findTurnByQuery(turns, arg.replace(/["']/g, ""));
          if (idx !== null) {
            fromIndex = idx;
          }
        }
      }
    }

    const turns = await getSessionTurns(session.id, fromIndex);
    if (turns.length === 0) {
      await ctx.reply("No turns to export.");
      return;
    }

    const data = buildExportData(session, turns);
    const json = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(json, "utf-8");

    const file = new InputFile(buffer, `alicewiki-${session.name}-${session.id}.json`);
    await ctx.replyWithDocument(
      file,
      { caption: fromIndex !== undefined ? `Exported from turn ${fromIndex} (${turns[0].query.slice(0, 40)}...)` : "Full session export" }
    );
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const query = ctx.message.text;

    // Don't process commands (handled above)
    if (query.startsWith("/")) return;

    try {
      const session = await getOrCreateSession(chatId);
      const history = await loadConversationHistory(session.id);
      const nextIndex = history.length / 2; // each turn = 2 messages (user + assistant)

      const { content, tokens } = await runAgent(getAgent(), query, history);
      const parsed = tryParseJSON(content) as ParsedResponse | null;

      await saveTurn(session.id, {
        query,
        turnIndex: nextIndex,
        summary: parsed?.summary ?? null,
        quotes: parsed?.quotes ? JSON.stringify(parsed.quotes) : null,
        sources: parsed?.sources ? JSON.stringify(parsed.sources) : null,
        raw: parsed ? null : content,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
      });

      if (parsed) {
        const parts: string[] = [];
        if (parsed.summary) parts.push(parsed.summary);

        if (parsed.sources && parsed.sources.length > 0) {
          const srcs = parsed.sources.map((s) => `- ${s.url || s.title}`);
          parts.push(`\nSources:\n${srcs.join("\n")}`);
        }

        await ctx.reply(parts.join("\n\n"));
      } else {
        await ctx.reply(content);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await ctx.reply(`Error: ${msg}`);
    }
  });
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const str = match ? match[1] : text.trim();
    return JSON.parse(str);
  } catch {
    return null;
  }
}
