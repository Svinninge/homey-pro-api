import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Persisted token data */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
  sessionToken?: string;
  sessionExpiresAt?: number;
  homeyLocalUrl?: string;
  homeyRemoteUrl?: string;
}

const TOKEN_FILE = process.env.TOKEN_FILE_PATH ?? join(process.cwd(), ".tokens.json");

/** Save tokens to disk (gitignored) */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

/** Load tokens from disk. Returns null if no stored tokens. */
export async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const data = await readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(data) as StoredTokens;
  } catch {
    return null;
  }
}

/** Check if the cloud access token is still valid (with 60s margin) */
export function isAccessTokenValid(tokens: StoredTokens): boolean {
  return tokens.expiresAt > Date.now() + 60_000;
}

/** Check if the Homey session token is still valid (with 60s margin) */
export function isSessionValid(tokens: StoredTokens): boolean {
  if (!tokens.sessionToken || !tokens.sessionExpiresAt) return false;
  return tokens.sessionExpiresAt > Date.now() + 60_000;
}
