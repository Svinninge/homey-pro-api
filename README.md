# Homey Pro API

TypeScript client and Claude AI agent for controlling a [Homey Pro](https://homey.app/en-us/homey-pro/) smart home hub.

## Features

- **OAuth2 Authentication** — Full 3-token chain (cloud token → delegation JWT → Homey session) with automatic token refresh
- **REST API Client** — Lightweight client for the Homey Pro local HTTP API (devices, zones, flows)
- **Claude AI Agent** — Natural language device control using Claude's tool-use capability
- **CLI** — Command-line interface for quick testing and interaction

## Architecture

```
src/
├── index.ts          # Public library exports
├── cli.ts            # CLI entry point (ping, devices, zones, flows, ask)
├── config.ts         # Environment config loader (.env.local)
├── auth.ts           # OAuth2 flow: authorize, token exchange, delegation, session
├── token-store.ts    # Persist and refresh tokens (.tokens.json)
├── homey-client.ts   # REST client for Homey Pro local API
├── claude-tools.ts   # Tool definitions for Claude API tool-use
└── agent.ts          # Agentic loop — Claude controls Homey autonomously
```

## Prerequisites

- Node.js 18+
- A Homey Pro on your local network
- A Homey Web API Client (OAuth2) — create one at [developer.athom.com](https://developer.athom.com)

## Setup

### 1. Install dependencies

```bash
git clone https://github.com/Svinninge/homey-pro-api.git
cd homey-pro-api
npm install
npm run build
```

### 2. Configure environment

Copy the example file and fill in your credentials:

```bash
cp .env.example .env.local
```

```env
# Required
HOMEY_CLIENT_ID=your-oauth2-client-id
HOMEY_CLIENT_SECRET=your-oauth2-client-secret
HOMEY_ADDRESS=http://192.168.1.xx    # Your Homey Pro local IP

# Optional (only for Claude agent mode)
ANTHROPIC_API_KEY=sk-ant-xxx
```

### 3. Add callback URL

In your Homey Web API Client settings at [developer.athom.com](https://developer.athom.com), add this callback URL:

```
http://localhost:3456/callback
```

### 4. Authorize

```bash
npm start -- auth
```

This opens your browser for Homey login. After authorization, tokens are saved to `.tokens.json` (gitignored). You only need to do this once — tokens refresh automatically.

## Usage

### CLI Commands

```bash
npm start -- ping          # Check connection to Homey Pro
npm start -- devices       # List all devices (name, class, id)
npm start -- zones         # List all zones
npm start -- flows         # List all flows
npm start -- ask "query"   # Ask Claude to control Homey (requires ANTHROPIC_API_KEY)
```

### Example output

```
$ npm start -- devices
  Dörrlås Entre (lock) - 03f4636d-7554-4525-b77f-32d4e3a00a2f
  Golvvärme WC BV (thermostat) - 0e76ba3f-16d5-4a61-8e65-5a4a41cb70b6
  Laddbox (evcharger) - 1345bf81-85df-4254-a1b2-af1029dbd057
  ...
  Total: 78 devices
```

### Claude Agent Mode

With `ANTHROPIC_API_KEY` set in `.env.local`, you can control Homey with natural language:

```bash
npm start -- ask "Turn off all lights in the living room"
npm start -- ask "What devices are in the garage?"
npm start -- ask "Trigger the goodnight flow"
```

Claude uses tool-use to autonomously decide which API calls to make.

### As a library

```typescript
import { HomeyClient, getValidSession, loadConfig } from "homey-pro-api";

const config = loadConfig();
const tokenFn = () => getValidSession(config.oauth2, config.homeyAddress);
const client = new HomeyClient(config.homeyAddress, tokenFn);

const devices = await client.getDevices();
const zones = await client.getZones();
await client.setCapability(deviceId, "onoff", true);
```

## OAuth2 Flow

The Homey API uses a 3-step token chain:

```
1. Browser login → Authorization Code
2. Code → Cloud Access Token + Refresh Token  (api.athom.com/oauth2/token)
3. Cloud Token → Delegation JWT               (api.athom.com/delegation/token)
4. Delegation JWT → Homey Session Token        (homey-local-ip/api/manager/users/login)
```

The session token is used for all local API calls. When tokens expire, they refresh automatically via the stored refresh token.

## Available Scopes

The OAuth2 client should have these scopes configured:

| Scope | Description |
|-------|-------------|
| `homey.device.readonly` | List and read devices |
| `homey.device.control` | Control device capabilities |
| `homey.zone.readonly` | List zones |
| `homey.flow.readonly` | List flows |
| `homey.flow.start` | Trigger flows |
| `homey.logic.readonly` | Read logic variables |
| `homey.logic` | Write logic variables |
| `homey.user.readonly` | Read user info |
| `homey.energy.readonly` | Read energy data |
| `homey.insights.readonly` | Read insights |

## Project Structure

```
homey-pro-api/
├── src/                  # TypeScript source
├── dist/                 # Compiled JavaScript (gitignored)
├── .env.local            # Secrets (gitignored)
├── .env.example          # Template for .env.local
├── .tokens.json          # OAuth2 tokens (gitignored)
├── CLAUDE.md             # Claude Code project instructions
├── package.json
└── tsconfig.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run CLI with tsx (no build needed) |
| `npm start` | Run compiled CLI |
| `npm test` | Run tests with vitest |

## License

MIT
