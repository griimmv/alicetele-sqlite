import { Bot, webhookCallback } from "grammy";
import { config } from "../lib/config.ts";
import type { Handler } from "express";

const bot = new Bot(config.botToken);
let webhookHandler: Handler | null = null;

export function getBot(): Bot {
  return bot;
}

export function getWebhookHandler(): Handler {
  if (!webhookHandler) {
    webhookHandler = webhookCallback(bot, "express", {
      secretToken: config.webhookSecret,
    });
  }
  return webhookHandler;
}

export async function setWebhook(url: string, secret?: string): Promise<void> {
  await bot.api.setWebhook(url, { secret_token: secret });
}
