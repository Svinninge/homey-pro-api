import express from "express";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { HomeyClient } from "./homey-client.js";
import { HomeyAgent, type AgentResult } from "./agent.js";
import type Anthropic from "@anthropic-ai/sdk";
import { getValidSession } from "./auth.js";
import { getAuthorizationUrl, exchangeCodeForSession } from "./auth-web.js";
import { loadTokens } from "./token-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const appVersion = JSON.parse(
  readFileSync(join(__dirname, "../version.json"), "utf-8")
).version as string;

if (!config.anthropicApiKey) {
  console.error("ANTHROPIC_API_KEY is required in .env.local for the web server.");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "../public")));

// ── Auth state (single-user) ──────────────────────────────────

let isAuthenticated = false;

// Check if we already have valid tokens on startup
loadTokens().then((tokens) => {
  if (tokens?.sessionToken) {
    isAuthenticated = true;
    console.log("  Existing tokens found — already authenticated.");
  }
});

// ── Signed cookie helpers ─────────────────────────────────────

const COOKIE_NAME = "homey_auth";

function sign(value: string): string {
  const hmac = createHmac("sha256", config.sessionSecret);
  hmac.update(value);
  return `${value}.${hmac.digest("base64url")}`;
}

function verify(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  if (sign(value) === signed) return value;
  return null;
}

function setAuthCookie(res: express.Response): void {
  const value = sign("authenticated");
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function isAuthCookieValid(req: express.Request): boolean {
  const cookie = req.cookies?.[COOKIE_NAME] ?? parseCookie(req, COOKIE_NAME);
  if (!cookie) return false;
  return verify(cookie) === "authenticated";
}

function parseCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(";").find((c) => c.trim().startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=")[1]);
}

// ── Auth middleware ───────────────────────────────────────────

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!isAuthenticated || !isAuthCookieValid(req)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// ── Routes: Auth ──────────────────────────────────────────────

let homeyConnected = false;

async function fetchHomeyInfo(): Promise<void> {
  try {
    console.log("  Connecting to Homey...");
    const tokenFn = () => getValidSession(config.oauth2, config.homeyAddress);
    const client = new HomeyClient(config.homeyAddress, tokenFn);
    const ok = await client.ping();
    if (!ok) throw new Error("Ping failed");
    homeyConnected = true;
    console.log(`  Connected to Homey at ${config.homeyAddress}`);
  } catch (err) {
    homeyConnected = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  Failed to connect to Homey:", msg);
  }
}

// Fetch Homey info on startup (non-blocking)
loadTokens().then((tokens) => {
  if (tokens?.sessionToken) fetchHomeyInfo();
});

app.get("/api/session", (req, res) => {
  res.json({
    loggedIn: isAuthenticated && isAuthCookieValid(req),
    version: appVersion,
    model: "claude-sonnet-4-6",
    homeyAddress: config.homeyAddress,
    homeyConnected,
  });
});

function getCallbackUrl(req: express.Request): string {
  const base = config.baseUrl ?? `${req.protocol}://${req.get("host")}`;
  return `${base}/auth/callback`;
}

app.get("/auth/login", (req, res) => {
  const authUrl = getAuthorizationUrl(config.oauth2, getCallbackUrl(req));
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("No authorization code received.");
    return;
  }
  try {
    await exchangeCodeForSession(
      config.oauth2,
      code,
      getCallbackUrl(req),
      config.homeyAddress
    );
    isAuthenticated = true;
    setAuthCookie(res);
    res.redirect("/");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Auth callback error:", msg);
    res.status(500).send(`Authorization failed: ${msg}`);
  }
});

app.post("/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// ── Routes: Chat ──────────────────────────────────────────────

// Conversation history (single-user, in-memory)
let chatHistory: Anthropic.MessageParam[] = [];

app.post("/api/chat", requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required." });
    return;
  }

  try {
    const tokenFn = () => getValidSession(config.oauth2, config.homeyAddress);
    const client = new HomeyClient(config.homeyAddress, tokenFn);
    const agent = new HomeyAgent(client, config.anthropicApiKey!);
    const result: AgentResult = await agent.run(message, chatHistory);
    chatHistory = result.history;
    res.json({ reply: result.reply });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Chat error:", msg);
    res.status(500).json({ error: "Failed to process message." });
  }
});

app.post("/api/chat/reset", requireAuth, (_req, res) => {
  chatHistory = [];
  res.json({ ok: true });
});

// ── SPA fallback ──────────────────────────────────────────────

app.get("/{*path}", (_req, res) => {
  res.sendFile(join(__dirname, "../public/index.html"));
});

// ── Start ─────────────────────────────────────────────────────

app.listen(config.webPort, () => {
  console.log(`\n🏠 Homey Chat running on http://localhost:${config.webPort}\n`);
});
