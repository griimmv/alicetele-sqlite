#!/usr/bin/env bun
import express from "express";
import { config } from "./lib/config.ts";
import { initDB } from "./db/indexdb.ts";
import { getBot, setWebhook } from "./bot/client.ts";
import { registerHandlers } from "./bot/handlers.ts";
import webhookRouter from "./routes/webhook.ts";

async function main() {
  console.log("Initializing database...");
  await initDB();

  const bot = getBot();
  registerHandlers(bot);

  const app = express();
  app.use(express.json());
  app.use("/api", webhookRouter);

  const webhookUrl = config.webhookUrl;
  if (webhookUrl) {
    const fullUrl = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;
    await setWebhook(fullUrl, config.webhookSecret);
    console.log(`Webhook set to ${fullUrl}`);
  } else {
    throw new Error("WEBHOOK_URL is not set. The bot cannot receive updates via webhook without it.");
  }

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
