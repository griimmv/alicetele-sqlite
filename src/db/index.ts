import mysql from "mysql2/promise";
import { config } from "../lib/config.ts";

let pool: mysql.Pool | null = null;

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
  pool = mysql.createPool(config.databaseUrl);
  const connection = await pool.getConnection();
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS sessions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(255) NOT NULL DEFAULT 'default',
      chat_id    BIGINT NOT NULL,
      archived   TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS turns (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      session_id    INT NOT NULL,
      turn_index    INT NOT NULL,
      query         TEXT NOT NULL DEFAULT '',
      summary       TEXT,
      quotes        TEXT,
      sources       TEXT,
      raw           TEXT,
      error         TEXT,
      input_tokens  INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )`);
    await connection.query("CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id, archived)");
    await connection.query("CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, turn_index)");
  } finally {
    connection.release();
  }
}

export async function getOrCreateSession(chatId: number): Promise<SessionRow> {
  if (!pool) throw new Error("DB not initialized");
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    "SELECT * FROM sessions WHERE chat_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1",
    [chatId]
  );
  if (rows.length > 0) return rows[0] as SessionRow;
  const [result] = await pool.execute(
    "INSERT INTO sessions (name, chat_id, archived) VALUES ('default', ?, 0)",
    [chatId]
  );
  const insertId = (result as mysql.ResultSetHeader).insertId;
  return { id: insertId, name: "default", chat_id: chatId, archived: 0, created_at: new Date().toISOString() };
}

export async function archiveSession(chatId: number): Promise<SessionRow> {
  if (!pool) throw new Error("DB not initialized");
  const session = await getOrCreateSession(chatId);
  await pool.execute("UPDATE sessions SET archived = 1 WHERE id = ?", [session.id]);
  return getOrCreateSession(chatId);
}

export async function getSessionTurns(sessionId: number, fromIndex?: number): Promise<TurnRow[]> {
  if (!pool) throw new Error("DB not initialized");
  if (fromIndex !== undefined) {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM turns WHERE session_id = ? AND turn_index >= ? ORDER BY turn_index ASC",
      [sessionId, fromIndex]
    );
    return rows as TurnRow[];
  }
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    "SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC",
    [sessionId]
  );
  return rows as TurnRow[];
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
  if (!pool) throw new Error("DB not initialized");
  await pool.execute(
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
  if (pool) {
    await pool.end();
    pool = null;
  }
}
