import { Bot, Context, GrammyError, InlineKeyboard } from "grammy";
import { toolRegistry } from "../engine/tools/indextools.ts";
import { runToolMode } from "../engine/tool-mode.ts";
import { parseJSONFromText } from "../engine/parser.ts";
import { getOrCreateSession, saveTurn, renameSession } from "../db/indexdb.ts";
import { loadConversationHistory } from "./session.ts";

const PREFIX = "t"; // prefix to distinguish tool-picker callbacks (e.g. "t:wikipedia") from other inline keyboards callback

const pendingQueries = new Map<number, string>();

export function setPendingQuery(chatId: number, query: string): void {
  pendingQueries.set(chatId, query);
}

export function getPendingQuery(chatId: number): string | undefined {
  return pendingQueries.get(chatId);
}

export function clearPendingQuery(chatId: number): void {
  pendingQueries.delete(chatId);
}

function cb(action: string): string {
  return `${PREFIX}:${action}`;
}

export function buildToolKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const entry of toolRegistry) {
    kb.text(entry.tool.name, cb(entry.tool.name)).row();
  }
  kb.text("Cancel", cb("cancel"));
  return kb;
}

async function handleToolCall(ctx: Context, chatId: number, msgId: number, toolName: string) {
  const query = getPendingQuery(chatId);
  if (!query) {
    await ctx.answerCallbackQuery("No pending query. Send a new message first.");
    return;
  }

  const found = toolRegistry.find(entry => entry.tool.name === toolName);
  if (!found) {
    await ctx.answerCallbackQuery(`Unknown tool: ${toolName}`);
    return;
  }

  clearPendingQuery(chatId);
  await ctx.answerCallbackQuery();

  try {
    const { content } = await runToolMode(query, toolName);
    const parsed = parseJSONFromText(content);

    const session = await getOrCreateSession(chatId);
    const history = await loadConversationHistory(session.id);
    const nextIndex = history.length / 2;

    await saveTurn(session.id, {
      query,
      turnIndex: nextIndex,
      summary: parsed?.summary as string | null ?? null,
      quotes: parsed?.quotes ? JSON.stringify(parsed.quotes) : null,
      sources: parsed?.sources ? JSON.stringify(parsed.sources) : null,
      raw: parsed ? null : content,
      inputTokens: 0,
      outputTokens: 0,
    });

    // rename session on first turn
    if (nextIndex === 0 && session.name === "default") {
      const title = query.length > 50 ? query.slice(0, 50) + "…" : query;
      await renameSession(session.id, title);
    }

    if (parsed) {
      const parts: string[] = [];
      const data = parsed as {
        summary?: string;
        quotes?: { text: string; source: string; url: string }[];
        sources?: { title: string; url: string }[];
      };
      if (data.summary) parts.push(data.summary);
      if (data.quotes?.length) {
        const quotes = data.quotes.map((quote, i) => `[${i + 1}] "${quote.text}"\n${quote.url}`);
        parts.push(`Direct Quotes:\n${quotes.join("\n\n")}`);
      }
      if (data.sources?.length) {
        const srcs = data.sources.map((source, i) => `[${i + 1}] ${source.title}\n${source.url}`);
        parts.push(`Sources:\n${srcs.join("\n\n")}`);
      }

      try {
        await ctx.editMessageText(parts.join("\n\n"), { reply_markup: undefined });
      } catch (err) {
        if (!(err instanceof GrammyError && err.error_code === 400 && err.description.includes("message to edit not found"))) {
          throw err;
        }
        await ctx.reply(parts.join("\n\n"));
      }
    } else {
      try {
        await ctx.editMessageText(content, { reply_markup: undefined });
      } catch (err) {
        if (!(err instanceof GrammyError && err.error_code === 400 && err.description.includes("message to edit not found"))) {
          throw err;
        }
        await ctx.reply(content);
      }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    try {
      await ctx.editMessageText(`Error: ${msg}`, { reply_markup: undefined });
    } catch {
      await ctx.reply(`Error: ${msg}`);
    }
  }
}

async function handleCancel(ctx: Context, chatId: number) {
  clearPendingQuery(chatId);
  try {
    await ctx.editMessageText("Cancelled.", { reply_markup: undefined });
  } catch {
    // ignore if message can't be edited
  }
  await ctx.answerCallbackQuery();
}

export function registerToolCallbacks(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${PREFIX}:`), async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;

    const chatId = ctx.chat?.id;
    const msgId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !msgId) return;

    const action = data.slice(PREFIX.length + 1);

    if (action === "cancel") {
      await handleCancel(ctx, chatId);
    } else {
      await handleToolCall(ctx, chatId, msgId, action);
    }
  });
}
