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
  db.run("CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, turn_index)");
}

export async function getOrCreateSession(chatId: number): Promise<SessionRow> {
  if (!db) throw new Error("DB not initialized");
  const row = db.query(
    "SELECT * FROM sessions WHERE chat_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1"
  ).get(chatId) as SessionRow | null;
  if (row) return row;

  const result = db.run(
    "INSERT INTO sessions (name, chat_id, archived) VALUES ('default', ?, 0)",
    [chatId]
  );
  return { id: Number(result.lastInsertRowid), name: "default", chat_id: chatId, archived: 0, created_at: new Date().toISOString() };
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

export async function closeDB(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
