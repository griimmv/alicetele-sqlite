import { $, spawn } from "bun";

// ngrok's endpoint to get tunnel connection and domain
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";

async function getNgrokUrl(): Promise<string | null> {
  try {
    const resp = await fetch(NGROK_API);
    const data = await resp.json() as any;
    return data.tunnels?.find((t: any) => t.proto === "https")?.public_url ?? null;
  } catch {
    return null;
  }
}

function waitForTunnel(timeout = 30_000): Promise<string> {
  const start = Date.now();
  return new Promise<string>((resolve, reject) => {
    const check = async () => {
      const url = await getNgrokUrl();
      if (url) return resolve(url);
      if (Date.now() - start >= timeout) {
        return reject(new Error("Timed out waiting for ngrok tunnel"));
      }
      setTimeout(check, 1000);
    };
    check();
  });
}

async function main() {
  // if ngrok tunnel already running — reuse its URL
  const existingUrl = await getNgrokUrl();
  if (existingUrl) {
    console.log(`ngrok: ${existingUrl}`);
    process.env.WEBHOOK_URL = existingUrl; // ngrok makes its own WEBHOOK_URL in-memory, so WEBHOOK_URL in .env.local is untouched
    const bot = spawn(["bun", "--watch", "src/index.ts"], {
      env: process.env,
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await bot.exited;
    process.exit(exitCode ?? 0);
  }

  // if ngrok not installed — show install link
  const which = await $`which ngrok`.quiet().text().catch(() => "");
  if (!which.trim()) {
    console.error("ngrok not found. Install: https://ngrok.com/download");
    process.exit(1);
  }

  // if ngrok installed, not running — spawn it
  const ngrok = spawn(["ngrok", "http", "3000"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const cleanup = () => { try { ngrok.kill(); } catch {} };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    // poll until tunnel URL is ready (up to 30s)
    const url = await waitForTunnel();
    console.log(`ngrok: ${url}`);
    process.env.WEBHOOK_URL = url;

    const bot = spawn(["bun", "src/index.ts"], {
      env: process.env,
      stdio: ["inherit", "inherit", "inherit"],
    });
    await bot.exited;
  } finally {
    // if Ctrl+C / exit — kill ngrok
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
