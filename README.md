# Homey Pro API

TypeScript client and Claude AI agent for controlling a [Homey Pro](https://homey.app/en-us/homey-pro/) smart home hub, with a web-based chat UI and Docker deployment.

## Features

- **Web Chat UI** — Browser-based chat interface for natural language smart home control
- **OAuth2 Authentication** — Full 3-token chain (cloud token → delegation JWT → Homey session) with automatic token refresh
- **REST API Client** — Lightweight client for the Homey Pro local HTTP API (devices, zones, flows)
- **Claude AI Agent** — Natural language device control using Claude's tool-use capability
- **CLI** — Command-line interface for quick testing and interaction
- **Docker** — Single-command deployment with docker compose

## Architecture

```
src/
├── server.ts         # Express web server (chat UI, OAuth2 login)
├── auth-web.ts       # OAuth2 flow adapted for web callbacks
├── cli.ts            # CLI entry point (ping, devices, zones, flows, ask)
├── config.ts         # Environment config loader (.env.local)
├── auth.ts           # OAuth2 flow: authorize, token exchange, delegation, session
├── token-store.ts    # Persist and refresh tokens (.tokens.json)
├── homey-client.ts   # REST client for Homey Pro local API
├── claude-tools.ts   # Tool definitions for Claude API tool-use
├── agent.ts          # Agentic loop — Claude controls Homey autonomously
└── index.ts          # Public library exports

public/
└── index.html        # Chat UI (login screen + chat interface)
```

## Prerequisites

- Node.js 18+ (or Docker)
- A Homey Pro on your local network
- A Homey Web API Client (OAuth2) — create one at [developer.athom.com](https://developer.athom.com)
- An Anthropic API key for Claude agent mode

## Quick Start with Docker

```bash
git clone https://github.com/Svinninge/homey-pro-api.git
cd homey-pro-api
cp .env.example .env.local   # Edit with your credentials
docker compose up -d
```

Open `http://localhost:3000`, click **Login with Homey**, and start chatting.

## Setup (Manual)

### 1. Install dependencies

```bash
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
HOMEY_ADDRESS=http://192.168.1.xx
ANTHROPIC_API_KEY=sk-ant-xxx

# Optional
# WEB_PORT=3000
# SESSION_SECRET=your-random-secret
```

### 3. Add callback URLs

In your Homey Web API Client settings at [developer.athom.com](https://developer.athom.com), add these callback URLs:

```
http://localhost:3456/callback              # For CLI auth
http://localhost:3000/auth/callback          # For web UI (local)
http://192.168.1.88:3000/auth/callback      # For web UI (LAN access)
```

### 4. Start

**Web UI:**
```bash
npm run server
```

**CLI only:**
```bash
npm start -- auth      # First-time authorization
npm start -- devices   # List devices
```

## Usage

### Web Chat UI

Start the server and open `http://localhost:3000` in your browser:

```bash
npm run server          # Production
npm run server:dev      # Development (auto-reload)
docker compose up -d    # Docker
```

Log in with your Homey account, then ask anything in natural language.

### CLI Commands

```bash
npm start -- ping          # Check connection to Homey Pro
npm start -- devices       # List all devices (name, class, id)
npm start -- zones         # List all zones
npm start -- flows         # List all flows
npm start -- ask "query"   # Ask Claude to control Homey
```

### Claude Agent Examples

```bash
# Query device status
npm start -- ask "Which lights are currently on?"
npm start -- ask "What devices are in the garage?"
npm start -- ask "Show me all thermostats and their temperatures"

# Control devices
npm start -- ask "Turn off all lights in the garage"
npm start -- ask "Dim the living room to 10%"
npm start -- ask "Set the hallway lights to 50% brightness"
npm start -- ask "Turn on the outdoor lights"

# Flows and automation
npm start -- ask "What flows are available?"
npm start -- ask "Trigger the goodnight flow"

# Complex queries
npm start -- ask "Are there any open doors or windows?"
npm start -- ask "Give me an overview of energy consumption devices"
```

### As a Library

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

## Docker

```bash
docker compose up -d          # Start
docker compose down            # Stop
docker compose up --build -d   # Rebuild after changes
docker logs homey-chat         # View logs
```

The container runs on port 3000, connects to Homey Pro on the LAN, and persists OAuth2 tokens in a `./data/` volume.

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
├── public/               # Web chat UI (static HTML)
├── dist/                 # Compiled JavaScript (gitignored)
├── data/                 # Token persistence for Docker
├── .env.local            # Secrets (gitignored)
├── .env.example          # Template for .env.local
├── Dockerfile            # Multi-stage Docker build
├── docker-compose.yml    # Docker deployment config
├── CLAUDE.md             # Claude Code project instructions
├── package.json
└── tsconfig.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run server` | Start web chat server |
| `npm run server:dev` | Start server with auto-reload |
| `npm run dev` | Run CLI with tsx |
| `npm start` | Run compiled CLI |
| `npm test` | Run tests with vitest |

## License

MIT
