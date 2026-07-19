import { Bot, Context, GrammyError, InlineKeyboard } from "grammy";
import type { SessionRow, TurnRow } from "../db/indexdb.ts";
import {
  listSessions,
  getSession,
  getSessionTurns,
  archiveSession,
  switchSession as switchDbSession,
  deleteSession as deleteDbSession,
  renameSession,
} from "../db/indexdb.ts";

const SESSIONS_PER_PAGE = 4;
const PREFIX = "s";

// Track one session-manager message per chat (chatId → messageId)
const managerMessages = new Map<number, number>();

// --- In-memory state per session-manager message ---

interface ManagerState {
  page: number;
  mode: "normal" | "delete" | "rename";
  text: string;
}

const states = new Map<string, ManagerState>();

// Track pending rename targets (chatId:fromId → sessionId)
const pendingRename = new Map<string, number>();

function pendingRenameKey(chatId: number, fromId: number): string {
  return `${chatId}:${fromId}`;
}

export function getPendingRename(chatId: number, fromId?: number): number | undefined {
  if (fromId === undefined) return undefined;
  return pendingRename.get(pendingRenameKey(chatId, fromId));
}

export function clearPendingRename(chatId: number, fromId?: number): void {
  if (fromId !== undefined) {
    pendingRename.delete(pendingRenameKey(chatId, fromId));
  } else {
    const prefix = `${chatId}:`;
    for (const key of pendingRename.keys()) {
      if (key.startsWith(prefix)) pendingRename.delete(key);
    }
  }
}

function stateKey(chatId: number, msgId: number): string {
  return `${chatId}:${msgId}`;
}

function getState(chatId: number, msgId: number): ManagerState {
  const key = stateKey(chatId, msgId);
  let state = states.get(key);
  if (!state) {
    state = { page: 1, mode: "normal", text: "" };
    states.set(key, state);
  }
  return state;
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
  rawPage: number,
  mode: "normal" | "delete" | "rename",
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  const page = Math.max(1, Math.min(rawPage, totalPages));
  const start = (page - 1) * SESSIONS_PER_PAGE;
  const pageSessions = sessions.slice(start, start + SESSIONS_PER_PAGE);
  const kb = new InlineKeyboard();

  for (const session of pageSessions) {
    const label = session.id === activeId
      ? `#${session.id}: ${session.name} ✅`
      : `#${session.id}: ${session.name}`;
    let action: string;
    if (mode === "delete") {
      action = cb("delask", session.id);
    } else if (mode === "rename") {
      action = cb("renameask", session.id);
    } else {
      action = cb("switch", session.id);
    }
    kb.text(label, action).row();
  }

  if (mode === "normal") {
    kb.text("➕ New", cb("new"));
    kb.text("✏️ Rename", cb("rename"));
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
  const lines = turns.map(turn => {
    const query = `${turn.query.slice(0, 60)}${turn.query.length > 60 ? "…" : ""}`;
    const ai = turn.summary ?? turn.raw ?? "";
    let sourcesText = "";
    if (turn.sources) {
      try {
        const sources = JSON.parse(turn.sources) as { title: string; url: string }[];
        if (sources.length > 0) {
          sourcesText = "\n\nSources:\n" + sources.map(src => `  - ${src.title} (${src.url})`).join("\n");
        }
      } catch {}
    }
    return `Turn ${turn.turn_index + 1}:\nQuery: ${query}\n\nAnswer: ${ai}${sourcesText}`;
  });
  const text = lines.join("\n\n");
  if (text.length > 3900) return text.slice(0, 3900) + "\n… (truncated)";
  return text;
}

function isBenignEditError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 400 && (
    err.description.includes("message to edit not found") ||
    err.description.includes("message is not modified")
  );
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
  } catch (err) {
    if (!isBenignEditError(err)) console.error("editManager error:", err);
  }
}

/** Refresh the session-manager keyboard without changing the text. */
async function refreshKeyboard(
  ctx: Context,
  chatId: number,
  msgId: number,
  mode: "normal" | "delete" | "rename",
  page?: number,
): Promise<void> {
  const sessions = await listSessions(chatId);
  const active = sessions.find(session => !session.archived);
  const state = getState(chatId, msgId);
  state.mode = mode;
  if (page !== undefined) state.page = page;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, state.page, mode);
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  } catch (err) {
    if (!isBenignEditError(err)) console.error("refreshKeyboard error:", err);
  }
  await ctx.answerCallbackQuery();
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
  const session = await archiveSession(chatId);
  const text = `Session ended. New session "#${session.id}: ${session.name}" started.`;
  const sessions = await listSessions(chatId);
  const state = getState(chatId, msgId);
  state.page = 1;
  state.mode = "normal";
  const kb = buildSessionKeyboard(sessions, session.id, 1, "normal");
  await editManager(ctx, chatId, msgId, text, kb);
  await ctx.answerCallbackQuery();
}

async function handlePage(ctx: Context, chatId: number, msgId: number, page: number) {
  const state = getState(chatId, msgId);
  await refreshKeyboard(ctx, chatId, msgId, state.mode, page);
}

async function handleDelete(ctx: Context, chatId: number, msgId: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(session => !session.archived);
  const state = getState(chatId, msgId);
  state.mode = "delete";
  state.page = 1;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, 1, "delete");
  await editManager(ctx, chatId, msgId, "Press a session to delete:", kb);
  await ctx.answerCallbackQuery();
}

async function handleRename(ctx: Context, chatId: number, msgId: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(session => !session.archived);
  const state = getState(chatId, msgId);
  state.mode = "rename";
  state.page = 1;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, 1, "rename");
  await editManager(ctx, chatId, msgId, "Press a session to rename:", kb);
  await ctx.answerCallbackQuery();
}

async function handleRenameask(ctx: Context, chatId: number, msgId: number, sessionId: number) {
  const session = await getSession(sessionId);
  if (!session || session.chat_id !== chatId) {
    await ctx.answerCallbackQuery("Session not found.");
    return;
  }
  pendingRename.set(pendingRenameKey(chatId, ctx.callbackQuery.from.id), sessionId);
  const kb = new InlineKeyboard()
    .text("Cancel", cb("renamecancel"));
  await editManager(ctx, chatId, msgId, `✏️ Send me the new name for "#${session.id}: ${session.name}":`, kb);
  await ctx.answerCallbackQuery();
}

async function handleRenamecancel(ctx: Context, chatId: number, msgId: number) {
  clearPendingRename(chatId, ctx.callbackQuery.from.id);
  await handleBack(ctx, chatId, msgId);
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
  const active = sessions.find(session => !session.archived);
  const state = getState(chatId, msgId);
  state.mode = "normal";
  state.page = 1;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, 1, "normal");
  await editManager(ctx, chatId, msgId, text, kb);
  await ctx.answerCallbackQuery();
}

async function handleDelno(ctx: Context, chatId: number, msgId: number) {
  await refreshKeyboard(ctx, chatId, msgId, "delete");
}

async function handleBack(ctx: Context, chatId: number, msgId: number) {
  const sessions = await listSessions(chatId);
  const active = sessions.find(session => !session.archived);
  const state = getState(chatId, msgId);
  state.mode = "normal";
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  state.page = Math.max(1, Math.min(state.page, totalPages));
  const pageLabel = totalPages === 1 ? "1/1" : `${state.page}/${totalPages}`;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, state.page, "normal");
  await editManager(ctx, chatId, msgId, `📂 Your sessions (${pageLabel}):`, kb);
  await ctx.answerCallbackQuery();
}

async function handleClose(ctx: Context, chatId: number, msgId: number) {
  clearPendingRename(chatId, ctx.callbackQuery.from.id);
  const key = stateKey(chatId, msgId);
  states.delete(key);
  managerMessages.delete(chatId);
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (err) {
    if (!isBenignEditError(err)) console.error("handleClose error:", err);
  }
  await ctx.answerCallbackQuery();
}

async function handleNop(ctx: Context) {
  await ctx.answerCallbackQuery();
}

// --- Public API ---

export function registerSessionCallbacks(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${PREFIX}:`), async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) {
      await ctx.answerCallbackQuery({ text: "Invalid callback data." });
      return;
    }

    const { action, args } = parseCb(data);
    const chatId = ctx.chat?.id;
    const msgId = ctx.callbackQuery.message?.message_id;
    if (!chatId || !msgId) {
      await ctx.answerCallbackQuery({ text: "Missing chat context." });
      return;
    }

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
      case "rename":
        await handleRename(ctx, chatId, msgId);
        break;
      case "renameask":
        await handleRenameask(ctx, chatId, msgId, Number(args[0]));
        break;
      case "renamecancel":
        await handleRenamecancel(ctx, chatId, msgId);
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
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  clearPendingRename(chatId);

  const sessions = await listSessions(chatId);
  const active = sessions.find(session => !session.archived);
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
    } catch (err) {
      if (isBenignEditError(err)) {
        managerMessages.delete(chatId);
      } else {
        console.error("showSessionManager edit error:", err);
      }
    }
  }

  const sent = await ctx.reply(text, { reply_markup: kb });
  managerMessages.set(chatId, sent.message_id);
  const state = getState(chatId, sent.message_id);
  state.text = text;
}

/** Complete a pending rename inline — updates the manager message. */
export async function completeRename(ctx: Context, chatId: number, sessionId: number, name: string): Promise<void> {
  await renameSession(sessionId, name);
  clearPendingRename(chatId, ctx.from?.id);

  const sessions = await listSessions(chatId);
  const active = sessions.find(session => !session.archived);
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  const text = `✅ Renamed to "${name}".\n\n📂 Your sessions (1/${totalPages}):`;
  const kb = buildSessionKeyboard(sessions, active?.id ?? null, 1, "normal");

  const existing = managerMessages.get(chatId);
  if (existing) {
    const key = stateKey(chatId, existing);
    states.delete(key);
    try {
      await ctx.api.editMessageText(chatId, existing, text, { reply_markup: kb });
      const state = getState(chatId, existing);
      state.text = text;
      return;
    } catch (err) {
      if (isBenignEditError(err)) {
        managerMessages.delete(chatId);
      } else {
        console.error("completeRename error:", err);
      }
    }
  }

  const sent = await ctx.reply(text, { reply_markup: kb });
  managerMessages.set(chatId, sent.message_id);
  const state = getState(chatId, sent.message_id);
  state.text = text;
}
