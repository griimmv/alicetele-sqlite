import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { config } from "../lib/config.ts";

let db: Database | null = null;

export interface SessionRow {
  id: number;
  name: string;
  chat_id: number;
  archived: number;
  mode: string;
  created_at: string;
}

export interface TurnRow {
  id: number;
  session_id: number;
  turn_index: number;
  query: string;
  summary: string | null;
  quotes: string | null;
  sources: string | null;
  raw: string | null;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

export async function initDB(): Promise<void> {
  const dbPath = resolve(config.databasePath);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT 'default',
    chat_id    INTEGER NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0,
    mode       TEXT NOT NULL DEFAULT 'agentic',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS turns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL,
    turn_index    INTEGER NOT NULL,
    query         TEXT NOT NULL DEFAULT '',
    summary       TEXT,
    quotes        TEXT,
    sources       TEXT,
    raw           TEXT,
    error         TEXT,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`);

  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id, archived)");
  try { db.run("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'agentic'"); } catch { /* already migrated */ }
  db.run("CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, turn_index)");
}
// Returns the active session for a chat, or creates one if none exists.
export async function getOrCreateSession(chatId: number): Promise<SessionRow> {
  if (!db) throw new Error("DB not initialized");
  const row = db.query(
    "SELECT * FROM sessions WHERE chat_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1"
  ).get(chatId) as SessionRow | null;
  if (row) return row;

    // Copy mode from previous session if exists
  const prev = db.query("SELECT mode FROM sessions WHERE chat_id = ? AND mode IS NOT NULL ORDER BY id DESC LIMIT 1").get(chatId) as { mode: string } | null;
  const result = db.run(
    "INSERT INTO sessions (name, chat_id, archived, mode) VALUES ('default', ?, 0, COALESCE(?, 'agentic'))",
    [chatId, prev?.mode ?? 'agentic']
  );
  return db.query("SELECT * FROM sessions WHERE id = ?").get(Number(result.lastInsertRowid)) as SessionRow;
}

export async function archiveSession(chatId: number): Promise<SessionRow> {
  if (!db) throw new Error("DB not initialized");
  const session = await getOrCreateSession(chatId);
  db.run("UPDATE sessions SET archived = 1 WHERE id = ?", [session.id]);
  return getOrCreateSession(chatId);
}

export async function getSessionTurns(sessionId: number, fromIndex?: number): Promise<TurnRow[]> {
  if (!db) throw new Error("DB not initialized");
  if (fromIndex !== undefined) {
    return db.query(
      "SELECT * FROM turns WHERE session_id = ? AND turn_index >= ? ORDER BY turn_index ASC"
    ).all(sessionId, fromIndex) as TurnRow[];
  }
  return db.query(
    "SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC"
  ).all(sessionId) as TurnRow[];
}

export async function saveTurn(
  sessionId: number,
  data: {
    query: string;
    turnIndex: number;
    summary?: string | null;
    quotes?: string | null;
    sources?: string | null;
    raw?: string | null;
    error?: string | null;
    inputTokens?: number;
    outputTokens?: number;
  }
): Promise<void> {
  if (!db) throw new Error("DB not initialized");
  db.run(
    `INSERT INTO turns (session_id, turn_index, query, summary, quotes, sources, raw, error, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      data.turnIndex,
      data.query,
      data.summary ?? null,
      data.quotes ?? null,
      data.sources ?? null,
      data.raw ?? null,
      data.error ?? null,
      data.inputTokens ?? 0,
      data.outputTokens ?? 0,
    ]
  );
}

export async function getActiveSession(chatId: number): Promise<SessionRow | null> {
  if (!db) return null;
  return db.query(
    "SELECT * FROM sessions WHERE chat_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1"
  ).get(chatId) as SessionRow | null;
}

export async function listSessions(chatId: number): Promise<SessionRow[]> {
  if (!db) throw new Error("DB not initialized");
  return db.query(
    "SELECT * FROM sessions WHERE chat_id = ? ORDER BY created_at DESC"
  ).all(chatId) as SessionRow[];
}

export async function getSession(sessionId: number): Promise<SessionRow | null> {
  if (!db) throw new Error("DB not initialized");
  return db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | null;
}

export async function switchSession(sessionId: number): Promise<SessionRow> {
  if (!db) throw new Error("DB not initialized");
  const switchTx = db.transaction((sid: number) => {
    const session = db.query("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow | null;
    if (!session) throw new Error(`Session ${sid} not found`);
    db.run("UPDATE sessions SET archived = 1 WHERE chat_id = ? AND archived = 0", [session.chat_id]);
    db.run("UPDATE sessions SET archived = 0 WHERE id = ?", [sid]);
    return db.query("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow;
  });
  return switchTx(sessionId);
}

export async function renameSession(sessionId: number, name: string): Promise<void> {
  if (!db) throw new Error("DB not initialized");
  db.run("UPDATE sessions SET name = ? WHERE id = ?", [name, sessionId]);
}

export async function deleteSession(sessionId: number): Promise<void> {
  if (!db) throw new Error("DB not initialized");
  db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

export async function getChatMode(chatId: number): Promise<string> {
  if (!db) return "agentic";
  const row = db.query(
    "SELECT mode FROM sessions WHERE chat_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1"
  ).get(chatId) as { mode: string } | null;
  return row?.mode ?? "agentic";
}

export async function setChatMode(chatId: number, mode: string): Promise<void> {
  if (!db) throw new Error("DB not initialized");
  db.run(
    "UPDATE sessions SET mode = ? WHERE chat_id = ? AND archived = 0",
    [mode, chatId]
  );
}

export async function closeDB(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
