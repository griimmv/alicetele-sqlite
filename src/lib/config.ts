const required = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

export const config = {
  botToken: process.env.BOT_TOKEN!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  databasePath: process.env.DATABASE_PATH || "./alicetele/data/alicewiki.db",
  port: Number(process.env.PORT) || 3000,
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  webhookUrl: process.env.WEBHOOK_URL || undefined,
  webhookSecret: process.env.WEBHOOK_SECRET || undefined,
} as const;

if (config.webhookUrl && !config.webhookSecret) {
  throw new Error(
    "WEBHOOK_SECRET is required when WEBHOOK_URL is configured",
  );
}
