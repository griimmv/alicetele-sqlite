import { Bot, Context, InlineKeyboard } from "grammy";
import type { SessionRow, TurnRow } from "../db/index.ts";
import {
  listSessions,
  getSession,
  getSessionTurns,
  getOrCreateSession,
  switchSession as switchDbSession,
  deleteSession as deleteDbSession,
} from "../db/index.ts";

const SESSIONS_PER_PAGE = 4;
const PREFIX = "s";

// Track one session-manager message per chat (chatId → messageId)
const managerMessages = new Map<number, number>();

// --- In-memory state per session-manager message ---

interface ManagerState {
  page: number;
  mode: "normal" | "delete";
  text: string;
}

const states = new Map<string, ManagerState>();

function stateKey(chatId: number, msgId: number): string {
  return `${chatId}:${msgId}`;
}

function getState(chatId: number, msgId: number): ManagerState {
  const key = stateKey(chatId, msgId);
  let s = states.get(key);
  if (!s) {
    s = { page: 1, mode: "normal", text: "" };
    states.set(key, s);
  }
  return s;
}

// --- Callback-data helpers ---

function cb(id: string, ...args: (string | number)[]): string {
  return `${PREFIX}:${id}${args.length ? ":" + args.join(":") : ""}`;
}

function parseCb(data: string): { action: string; args: string[] } {
  const parts = data.split(":");
  return { action: parts[1], args: parts.slice(2) };
}

// --- Keyboard builder ---

function buildSessionKeyboard(
  sessions: SessionRow[],
  activeId: number | null,
  page: number,
  mode: "normal" | "delete",
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  const start = (page - 1) * SESSIONS_PER_PAGE;
  const pageSessions = sessions.slice(start, start + SESSIONS_PER_PAGE);
  const kb = new InlineKeyboard();

  for (const s of pageSessions) {
    const label = s.id === activeId
      ? `#${s.id}: ${s.name} ✅`
      : `#${s.id}: ${s.name}`;
    const action = mode === "delete" ? cb("delask", s.id) : cb("switch", s.id);
    kb.text(label, action).row();
  }

  if (mode === "normal") {
    kb.text("➕ New", cb("new"));
    kb.text("🗑 Delete", cb("delete"));
    kb.text("✖ Close", cb("close"));
  } else {
    kb.text("← Back", cb("back"));
  }

  if (totalPages > 1) {
    kb.row();
    if (page > 1) kb.text("<", cb("page", page - 1));
    kb.text(`Page ${page}/${totalPages}`, cb("nop"));
    if (page < totalPages) kb.text(">", cb("page", page + 1));
  }

  return kb;
}

// --- Helpers ---

function formatTurns(turns: TurnRow[]): string {
  const lines = turns.map(t =>
    `Turn ${t.turn_index + 1}: ${t.query.slice(0, 60)}${t.query.length > 60 ? "…" : ""}`
  );
  const text = lines.join("\n");
  if (text.length > 3500) return text.slice(0, 3500) + "\n… (truncated)";
  return text;
}

async function editManager(
  ctx: Context,
  chatId: number,
  msgId: number,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  const state = getState(chatId, msgId);
  state.text = text;
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch {
    // message may be too old to edit; ignore
  }
}

// --- Callback handlers ---

async function handleSwitch(ctx: Context, chatId: number, msgId: number, sessionId: number) {
  const session = await getSession(sessionId);
  if (!session || session.chat_id !== chatId) {
    await ctx.answerCallbackQuery("Session not found.");
    return;
  }

  const state = getState(chatId, msgId);
  const wasActive = !session.archived;

  if (!wasActive) {
    await switchDbSession(sessionId);
  }

  const turns = await getSessionTurns(sessionId);
  const turnText = formatTurns(turns);
  const header = wasActive
    ? `✅ Already on Session #${session.id} (${session.name})`
    : `✅ Switched to Session #${session.id} (${session.name})`;
  const text = turnText ? `${header}\n\n${turnText}` : header;

  const sessions = await listSessions(chatId);
  state.page = 1;
  state.mode = "normal";
  const kb = buildSessionKeyboard(sessions, session.id, 1, "normal");
  await editManager(ctx, chatId, msgId, text, kb);
  await ctx.answerCallbackQuery();
}

async function handleNew(ctx: Context, chatId: number, msgId: number) {
  const session = await getOrCreateSession(chatId);
  const text = `✅ New session "#${session.id}: ${session.name}" created.`;
  const sessions = await listSessions(chatId);
  const state = getState(chatId, msgId);
  state.page = 1;
  state.mode = "normal";
  const kb = buildSessionKeyboard(sessions, session.id, 1, "normal");
  await editManager(ctx, chatId, msgId, text, kb);
  await ctx.answerCallbackQuery();
}

async function handlePage(ctx: Context, chatId: number, msgId: number, page: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(s => !s.archived);
  const state = getState(chatId, msgId);
  state.page = page;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, page, state.mode);
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  } catch { /* ignore */ }
  await ctx.answerCallbackQuery();
}

async function handleDelete(ctx: Context, chatId: number, msgId: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(s => !s.archived);
  const state = getState(chatId, msgId);
  state.mode = "delete";
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, state.page, "delete");
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  } catch { /* ignore */ }
  await ctx.answerCallbackQuery();
}

async function handleDelask(ctx: Context, chatId: number, msgId: number, sessionId: number) {
  const session = await getSession(sessionId);
  if (!session || session.chat_id !== chatId) {
    await ctx.answerCallbackQuery("Session not found.");
    return;
  }
  const kb = new InlineKeyboard()
    .text("Yes", cb("delyes", sessionId))
    .text("No", cb("delno"));
  await editManager(ctx, chatId, msgId, `🗑 Delete "#${session.id}: ${session.name}"?`, kb);
  await ctx.answerCallbackQuery();
}

async function handleDelyes(ctx: Context, chatId: number, msgId: number, sessionId: number) {
  const session = await getSession(sessionId);
  if (!session || session.chat_id !== chatId) {
    await ctx.answerCallbackQuery("Session not found.");
    return;
  }
  await deleteDbSession(sessionId);
  const text = `✅ Session "#${session.id}: ${session.name}" deleted.`;
  const sessions = await listSessions(chatId);
  const active = sessions.find(s => !s.archived);
  const state = getState(chatId, msgId);
  state.mode = "normal";
  state.page = 1;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, 1, "normal");
  await editManager(ctx, chatId, msgId, text, kb);
  await ctx.answerCallbackQuery();
}

async function handleDelno(ctx: Context, chatId: number, msgId: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(s => !s.archived);
  const state = getState(chatId, msgId);
  state.mode = "delete";
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, state.page, "delete");
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  } catch { /* ignore */ }
  await ctx.answerCallbackQuery();
}

async function handleBack(ctx: Context, chatId: number, msgId: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(s => !s.archived);
  const state = getState(chatId, msgId);
  state.mode = "normal";
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, state.page, "normal");
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  } catch { /* ignore */ }
  await ctx.answerCallbackQuery();
}

async function handleClose(ctx: Context, chatId: number, msgId: number) {
  const key = stateKey(chatId, msgId);
  states.delete(key);
  managerMessages.delete(chatId);
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch { /* ignore */ }
  await ctx.answerCallbackQuery();
}

async function handleNop(ctx: Context) {
  await ctx.answerCallbackQuery();
}

// --- Public API ---

export function registerSessionCallbacks(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${PREFIX}:`), async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;

    const { action, args } = parseCb(data);
    const chatId = ctx.chat?.id;
    const msgId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !msgId) return;

    switch (action) {
      case "switch":
        await handleSwitch(ctx, chatId, msgId, Number(args[0]));
        break;
      case "new":
        await handleNew(ctx, chatId, msgId);
        break;
      case "page":
        await handlePage(ctx, chatId, msgId, Number(args[0]));
        break;
      case "delete":
        await handleDelete(ctx, chatId, msgId);
        break;
      case "delask":
        await handleDelask(ctx, chatId, msgId, Number(args[0]));
        break;
      case "delyes":
        await handleDelyes(ctx, chatId, msgId, Number(args[0]));
        break;
      case "delno":
        await handleDelno(ctx, chatId, msgId);
        break;
      case "back":
        await handleBack(ctx, chatId, msgId);
        break;
      case "close":
        await handleClose(ctx, chatId, msgId);
        break;
      case "nop":
        await handleNop(ctx);
        break;
    }
  });
}

export async function showSessionManager(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;

  const sessions = await listSessions(chatId);
  const active = sessions.find(s => !s.archived);
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  const pageLabel = totalPages === 1 ? "1/1" : `1/${totalPages}`;
  const text = `📂 Your sessions (${pageLabel}):`;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, 1, "normal");

  // Reuse existing manager message if available
  const existing = managerMessages.get(chatId);
  if (existing) {
    const key = stateKey(chatId, existing);
    states.delete(key);
    try {
      await ctx.api.editMessageText(chatId, existing, text, { reply_markup: kb });
      const state = getState(chatId, existing);
      state.text = text;
      return;
    } catch {
      // message was deleted or too old — fall through to send new
    }
  }

  const sent = await ctx.reply(text, { reply_markup: kb });
  managerMessages.set(chatId, sent.message_id);
  const state = getState(chatId, sent.message_id);
  state.text = text;
}
