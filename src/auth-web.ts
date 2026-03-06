import type { OAuth2Config } from "./config.js";
import {
  exchangeCodeForTokens,
  getDelegationToken,
  createHomeySession,
} from "./auth.js";
import { saveTokens, type StoredTokens } from "./token-store.js";

const ATHOM_BASE = "https://api.athom.com";

/** Build the Athom OAuth2 authorization URL for web-based login. */
export function getAuthorizationUrl(
  config: OAuth2Config,
  redirectUri: string
): string {
  const url = new URL(`${ATHOM_BASE}/oauth2/authorise`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

/**
 * Complete the full OAuth2 token chain for web login:
 * authorization code → cloud tokens → delegation JWT → Homey session.
 */
export async function exchangeCodeForSession(
  config: OAuth2Config,
  code: string,
  redirectUri: string,
  homeyAddress: string
): Promise<StoredTokens> {
  const cloudTokens = await exchangeCodeForTokens(config, code, redirectUri);
  const delegationJwt = await getDelegationToken(cloudTokens.accessToken);
  const sessionToken = await createHomeySession(homeyAddress, delegationJwt);

  const tokens: StoredTokens = {
    ...cloudTokens,
    sessionToken,
    sessionExpiresAt: Date.now() + 3600_000,
    homeyLocalUrl: homeyAddress,
  };
  await saveTokens(tokens);
  return tokens;
}
