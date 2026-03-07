import { randomUUID } from "node:crypto";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local", override: true });

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  callbackPort: number;
}

export interface HomeyConfig {
  address: string;
  token: string;
}

export interface AppConfig {
  oauth2: OAuth2Config;
  homeyAddress: string;
  anthropicApiKey?: string;
  webPort: number;
  sessionSecret: string;
  baseUrl?: string;
}

export function loadConfig(): AppConfig {
  const clientId = process.env.HOMEY_CLIENT_ID;
  const clientSecret = process.env.HOMEY_CLIENT_SECRET;
  const address = process.env.HOMEY_ADDRESS;

  if (!clientId) {
    throw new Error("HOMEY_CLIENT_ID is required in .env.local");
  }
  if (!clientSecret) {
    throw new Error("HOMEY_CLIENT_SECRET is required in .env.local");
  }
  if (!address) {
    throw new Error("HOMEY_ADDRESS is required in .env.local");
  }

  return {
    oauth2: {
      clientId,
      clientSecret,
      callbackPort: parseInt(process.env.OAUTH_CALLBACK_PORT ?? "3456", 10),
    },
    homeyAddress: address,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    webPort: parseInt(process.env.WEB_PORT ?? "3000", 10),
    sessionSecret: process.env.SESSION_SECRET ?? randomUUID(),
    baseUrl: process.env.BASE_URL,
  };
}
