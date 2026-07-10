import { Bot, InputFile } from "grammy";
import { createAgent, runAgent } from "../engine/agent.ts";
import { parseJSONFromText } from "../engine/parser.ts";
import { createLLM } from "../engine/llm.ts";
import { getOrCreateSession, archiveSession, getSessionTurns, saveTurn, getActiveSession, renameSession, getChatMode, setChatMode } from "../db/indexdb.ts";
import { loadConversationHistory, buildExportData, findTurnByQuery } from "./session.ts";
import { registerSessionCallbacks, showSessionManager } from "./session-handler.ts";
import { buildToolKeyboard, setPendingQuery, registerToolCallbacks } from "./tool-selector.ts";

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
      + "/sessions - Manage sessions (switch, create, delete)\n"
      + "/rename <name> - Rename the current session\n"
      + "/mode [agentic|tool] - Toggle between agentic and tool mode\n"
      + "/tokens - Show token usage for this session\n"
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

  bot.command("sessions", async (ctx) => {
    await showSessionManager(ctx);
  });

  bot.command("rename", async (ctx) => {
    const chatId = ctx.chat.id;
    const name = ctx.match?.trim();
    if (!name) {
      await ctx.reply("Usage: /rename <new name>");
      return;
    }
    const session = await getActiveSession(chatId);
    if (!session) {
      await ctx.reply("No active session to rename.");
      return;
    }
    await renameSession(session.id, name);
    await ctx.reply(`✅ Renamed to "${name}".`);
  });

  bot.command("tokens", async (ctx) => {
    const chatId = ctx.chat.id;
    const session = await getActiveSession(chatId);
    if (!session) {
      await ctx.reply("No active session.");
      return;
    }
    const turns = await getSessionTurns(session.id);
    const totalInput = turns.reduce((sum, turn) => sum + turn.input_tokens, 0);
    const totalOutput = turns.reduce((sum, turn) => sum + turn.output_tokens, 0);
    await ctx.reply(
      `Session: ${session.name}\n`
      + `Turns: ${turns.length}\n`
      + `Input tokens: ${totalInput.toLocaleString()}\n`
      + `Output tokens: ${totalOutput.toLocaleString()}\n`
      + `Total tokens: ${(totalInput + totalOutput).toLocaleString()}`
    );
  });

  bot.command("mode", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = ctx.match?.trim().toLowerCase();
    if (arg === "agentic" || arg === "tool") {
      await setChatMode(chatId, arg);
      await ctx.reply(`Mode switched to "${arg}".`);
    } else {
      const current = await getChatMode(chatId);
      await ctx.reply(
        `Current mode: ${current}\n\nUse /mode agentic or /mode tool to switch.`
      );
    }
  });

  registerSessionCallbacks(bot);
  registerToolCallbacks(bot);

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const query = ctx.message.text;

    // Don't process commands (handled above)
    if (query.startsWith("/")) return;

    try {
      const session = await getOrCreateSession(chatId);
      const history = await loadConversationHistory(session.id);
      const nextIndex = history.length / 2; // each turn = 2 messages (user + assistant)

      const sessionMode = await getChatMode(chatId);

      if (sessionMode === "tool") {
        setPendingQuery(chatId, query);
        await ctx.reply("Choose a tool:", { reply_markup: buildToolKeyboard() });
        return;
      }

      const { content, tokens } = await runAgent(getAgent(), query, history);
      const parsed = parseJSONFromText(content) as ParsedResponse | null;

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

      // rename session title on first user's query
      if (nextIndex === 0 && session.name === 'default') {
        const title = query.length > 50 ? query.slice(0, 50) + '\u2026' : query;
        await renameSession(session.id, title);
      }

      // llm query response assembler (summary, direct quotes, and sources)
      if (parsed) {
        const parts: string[] = [];
        if (parsed.summary) parts.push(parsed.summary);

        if (parsed.quotes && parsed.quotes.length > 0) {
          const quotes = parsed.quotes.map(
            (quote, i) => `[${i + 1}] "${quote.text}"\n${quote.url}`
          );
          parts.push(`Direct Quotes:\n${quotes.join("\n\n")}`);
        }

        if (parsed.sources && parsed.sources.length > 0) {
          const srcs = parsed.sources.map(
            (source, i) => `[${i + 1}] ${source.title}\n${source.url}`
          );
          parts.push(`Sources:\n${srcs.join("\n\n")}`);
        }

        if (parts.length > 0) {
           await ctx.reply(parts.join("\n\n"));
         } else {
           await ctx.reply("Received an empty response.");
         }
      } else {
        await ctx.reply(content);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await ctx.reply(`Error: ${msg}`);
    }
  });
}
