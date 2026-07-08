import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { resolve } from "path";

const ENV_PATH = resolve(import.meta.dir, "..", ".env.local");

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

// Extract existing WEBHOOK_SECRET from env file
function getExistingSecret(content: string): string | null {
  const match = content.match(/^WEBHOOK_SECRET=(.*)$/m);
  return match ? match[1].trim() : null;
}

// Treat empty or "your_..." as a placeholder
function isPlaceholder(value: string): boolean {
  return !value || value.startsWith("your_");
}

function main() {
  // File already exists — check and update
  if (existsSync(ENV_PATH)) {
    const content = readFileSync(ENV_PATH, "utf-8");
    const existing = getExistingSecret(content);

    // if valid secret is present — nothing to do
    if (existing && !isPlaceholder(existing)) {
      console.log("WEBHOOK_SECRET already set in .env.local — skipping.");
      return;
    }

    // Replace placeholder or add missing secret
    const secret = generateSecret();
    if (existing) {
      const updated = content.replace(/^WEBHOOK_SECRET=.*$/m, `WEBHOOK_SECRET=${secret}`);
      writeFileSync(ENV_PATH, updated);
    } else {
      appendFileSync(ENV_PATH, `\nWEBHOOK_SECRET=${secret}\n`);
    }
    console.log("Generated WEBHOOK_SECRET and saved to .env.local");
    return;
  }

  // if there's no .env.local yet, create one with a fresh secret
  const secret = generateSecret();
  writeFileSync(ENV_PATH, [
    "BOT_TOKEN=",
    "OPENAI_API_KEY=",
    "DATABASE_PATH=./data/alicewiki.db",
    "PORT=3000",
    `WEBHOOK_SECRET=${secret}`,
    "",
  ].join("\n"));
  console.log("Created .env.local with a generated WEBHOOK_SECRET.");
  console.log("Fill in BOT_TOKEN and OPENAI_API_KEY to get started.");
}

main();
