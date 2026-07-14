import { existsSync, readFileSync, appendFileSync, writeFileSync, chmodSync } from "fs";
import { spawnSync } from "child_process";
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

// Restrict file to owner-only read/write (chmod 600 on Unix, icacls on Windows)
function setFilePermissions(path: string) {
  if (process.platform === "win32") {
    const reset = spawnSync("icacls", [path, "/reset"]);
    if (reset.status !== 0) {
      throw new Error(`icacls /reset failed with status ${reset.status}: ${reset.stderr?.toString()}`);
    }
    const grant = spawnSync("icacls", [path, "/grant:r", `${process.env.USERNAME}:(F)`, "/inheritance:r"]);
    if (grant.status !== 0) {
      throw new Error(`icacls /grant failed with status ${grant.status}: ${grant.stderr?.toString()}`);
    }
  } else {
    chmodSync(path, 0o600);
  }
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
      setFilePermissions(ENV_PATH);
    } else {
      appendFileSync(ENV_PATH, `\nWEBHOOK_SECRET=${secret}\n`);
      setFilePermissions(ENV_PATH);
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
    "WEBHOOK_URL=   # if you'll use ngrok, don't worry about this as ngrok generates its own url",
  ].join("\n"));
  setFilePermissions(ENV_PATH);
  console.log("Created .env.local with a generated WEBHOOK_SECRET.");
  console.log("Fill in BOT_TOKEN and OPENAI_API_KEY to get started.");
}

main();
