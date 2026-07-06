const required = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

export const config = {
  botToken: process.env.BOT_TOKEN!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  databasePath: process.env.DATABASE_PATH || "./data/alicewiki.db",
  port: Number(process.env.PORT)!,
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  webhookUrl: process.env.WEBHOOK_URL || undefined,
  webhookSecret: process.env.WEBHOOK_SECRET || undefined,
} as const;
