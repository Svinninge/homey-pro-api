import { createServer } from "node:http";
import { URL } from "node:url";
import type { OAuth2Config } from "./config.js";
import {
  type StoredTokens,
  saveTokens,
  loadTokens,
  isAccessTokenValid,
  isSessionValid,
} from "./token-store.js";

const ATHOM_BASE = "https://api.athom.com";

// ── OAuth2 Authorization Flow ─────────────────────────────────

/**
 * Run the full OAuth2 authorization flow:
 * 1. Start local callback server
 * 2. Open browser for user authorization
 * 3. Exchange code for tokens
 * 4. Get delegation token + Homey session
 */
export async function authorize(
  config: OAuth2Config,
  homeyAddress: string
): Promise<StoredTokens> {
  const redirectUri = `http://localhost:${config.callbackPort}/callback`;

  // Step 1: Get authorization code via browser
  console.log("\n🔐 Starting Homey OAuth2 authorization...\n");
  console.log("  Make sure your Homey Web API Client has this callback URL:");
  console.log(`  ${redirectUri}\n`);

  const code = await getAuthorizationCode(config, redirectUri);
  console.log("✅ Authorization code received.\n");

  // Step 2: Exchange code for cloud tokens
  console.log("🔄 Exchanging code for access token...");
  const cloudTokens = await exchangeCodeForTokens(config, code, redirectUri);
  console.log("✅ Cloud access token obtained.\n");

  // Step 3: Get delegation token
  console.log("🔄 Getting delegation token...");
  const delegationJwt = await getDelegationToken(cloudTokens.accessToken);
  console.log("✅ Delegation token obtained.\n");

  // Step 4: Create Homey session
  console.log(`🔄 Creating session on ${homeyAddress}...`);
  const sessionToken = await createHomeySession(homeyAddress, delegationJwt);
  console.log("✅ Homey session created.\n");

  // Save everything
  const tokens: StoredTokens = {
    ...cloudTokens,
    sessionToken,
    sessionExpiresAt: Date.now() + 3600_000, // ~1 hour
    homeyLocalUrl: homeyAddress,
  };
  await saveTokens(tokens);
  console.log("💾 Tokens saved to .tokens.json\n");

  return tokens;
}

/**
 * Get a valid Homey session token, refreshing if needed.
 */
export async function getValidSession(
  config: OAuth2Config,
  homeyAddress: string
): Promise<string> {
  const tokens = await loadTokens();

  if (!tokens) {
    throw new Error(
      'No stored tokens. Run "npm start -- auth" first to authorize.'
    );
  }

  // If session is still valid, return it
  if (isSessionValid(tokens)) {
    return tokens.sessionToken!;
  }

  // If cloud token is expired, refresh it
  let accessToken = tokens.accessToken;
  if (!isAccessTokenValid(tokens)) {
    console.log("🔄 Refreshing cloud access token...");
    const refreshed = await refreshAccessToken(config, tokens.refreshToken);
    tokens.accessToken = refreshed.accessToken;
    tokens.refreshToken = refreshed.refreshToken;
    tokens.expiresAt = refreshed.expiresAt;
    accessToken = refreshed.accessToken;
  }

  // Get new delegation + session
  const delegationJwt = await getDelegationToken(accessToken);
  const sessionToken = await createHomeySession(homeyAddress, delegationJwt);

  tokens.sessionToken = sessionToken;
  tokens.sessionExpiresAt = Date.now() + 3600_000;
  await saveTokens(tokens);

  return sessionToken;
}

// ── Internal helpers ──────────────────────────────────────────

/** Start a local server and open the browser for authorization */
function getAuthorizationCode(
  config: OAuth2Config,
  redirectUri: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${config.callbackPort}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>✅ Authorization successful!</h2><p>You can close this tab.</p></body></html>"
          );
          server.close();
          resolve(code);
        } else {
          const error = url.searchParams.get("error") ?? "No code received";
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>❌ Error: ${error}</h2></body></html>`);
          server.close();
          reject(new Error(error));
        }
      }
    });

    server.listen(config.callbackPort, () => {
      const authUrl = new URL(`${ATHOM_BASE}/oauth2/authorise`);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", config.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);

      console.log("  Open this URL in your browser:\n");
      console.log(`  ${authUrl.toString()}\n`);
      console.log("  Waiting for authorization...\n");

      // Try to open browser automatically
      const openCmd =
        process.platform === "win32"
          ? "start"
          : process.platform === "darwin"
            ? "open"
            : "xdg-open";
      import("node:child_process").then(({ exec }) => {
        exec(`${openCmd} "${authUrl.toString()}"`);
      });
    });

    server.on("error", reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 5 minutes"));
    }, 300_000);
  });
}

/** Exchange authorization code for cloud access + refresh tokens */
async function exchangeCodeForTokens(
  config: OAuth2Config,
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const basicAuth = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString("base64");

  const res = await fetch(`${ATHOM_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + parseInt(data.expires_in, 10) * 1000,
  };
}

/** Refresh an expired cloud access token */
async function refreshAccessToken(
  config: OAuth2Config,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const basicAuth = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString("base64");

  const res = await fetch(`${ATHOM_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + parseInt(data.expires_in, 10) * 1000,
  };
}

/** Get a delegation JWT for the Homey */
async function getDelegationToken(accessToken: string): Promise<string> {
  const res = await fetch(
    `${ATHOM_BASE}/delegation/token?audience=homey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Delegation token failed (${res.status}): ${body}`);
  }

  // Response may be a JSON-encoded string ("eyJ...") or raw JWT
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "string" ? parsed : parsed.token ?? text;
  } catch {
    return text;
  }
}

/** Create a session on the local Homey using a delegation JWT */
async function createHomeySession(
  homeyAddress: string,
  delegationJwt: string
): Promise<string> {
  const baseUrl = homeyAddress.replace(/\/+$/, "");

  const res = await fetch(`${baseUrl}/api/manager/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: delegationJwt }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Homey login failed (${res.status}): ${body}`);
  }

  // Response is the session token string (or JSON with token)
  const data = await res.text();
  try {
    const parsed = JSON.parse(data);
    return parsed.token ?? parsed;
  } catch {
    return data;
  }
}
