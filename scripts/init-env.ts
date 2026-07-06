import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { resolve } from "path";

const ENV_PATH = resolve(import.meta.dir, "..", ".env.local");

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

function getExistingSecret(content: string): string | null {
  const match = content.match(/^WEBHOOK_SECRET=(.*)$/m);
  return match ? match[1].trim() : null;
}

function isPlaceholder(value: string): boolean {
  return !value || value.startsWith("your_");
}

function main() {
  if (existsSync(ENV_PATH)) {
    const content = readFileSync(ENV_PATH, "utf-8");
    const existing = getExistingSecret(content);

    if (existing && !isPlaceholder(existing)) {
      console.log("WEBHOOK_SECRET already set in .env.local — skipping.");
      return;
    }

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
