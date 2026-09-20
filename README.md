# Homey Pro API

TypeScript client and Claude AI agent for controlling a [Homey Pro](https://homey.app/en-us/homey-pro/) smart home hub, with a web-based chat UI and Docker deployment.

## Features

- **MCP server** — Homey Pro as tools for Claude Code / Claude Desktop over stdio (`npm run mcp`)
- **Web Chat UI** — Browser-based chat interface for natural language smart home control
- **OAuth2 Authentication** — Full 3-token chain (cloud token → delegation JWT → Homey session) with automatic token refresh
- **REST API Client** — Lightweight client for the Homey Pro local HTTP API (devices, zones, flows)
- **Claude AI Agent** — Natural language device control using Claude's tool-use capability
- **CLI** — Command-line interface for quick testing and interaction
- **Docker + Tailscale** — Deployment with Tailscale VPN networking and automatic HTTPS via Tailscale Serve
- **Versioning** — Auto-incrementing version shown in the UI header

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
├── mcp.ts            # MCP server over stdio: the tool contract and its annotations
├── mcp-format.ts     # Pure shaping: pagination, zone paths, device summaries
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
docker compose up -d --build
```

The app runs behind Tailscale with automatic HTTPS. Access it at `https://<hostname>.ts.net` (your Tailscale machine name). Click **Login with Homey** and start chatting.

> **Note:** Add `https://<hostname>.ts.net/auth/callback` as a redirect URI in your Homey OAuth2 app at [developer.athom.com](https://developer.athom.com).

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
https://<hostname>.ts.net/auth/callback     # For web UI (Tailscale HTTPS)
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

## MCP server

The same client and OAuth chain, exposed as MCP tools so Claude Code and Claude Desktop can reach
the house directly — no chat UI in between.

```bash
npm run build
npm run mcp          # stdio; a client starts this for you
npm run mcp:dev      # same, straight from TypeScript
```

Register it on this computer (needs `.env.local` and one `npm start -- auth` first, so
`.tokens.json` exists):

```bash
claude mcp add homey -s user -- node "C:\Users\perno\homey-pro-api\dist\mcp.js"
```

The Homey is only reached on the first tool call that needs it, so a client can list the tools on a
machine that has never run the OAuth flow.

| Tool | What it does | Annotation |
|---|---|---|
| `homey_list_zones` | Zones as a tree: id, name, full path, parent, device count | `readOnly` |
| `homey_list_devices` | One page of devices — what they are and can do; filter by zone, class, name or capability | `readOnly` |
| `homey_get_device` | One device with its current capability values | `readOnly` |
| `homey_set_capability` | Set one capability (onoff, dim, target_temperature, locked) | **`destructive`** |
| `homey_list_flows` | One page of flows, **both** standard and advanced | `readOnly` |
| `homey_run_flow` | Start a flow; `kind` must match what the list reported | **`destructive`**, not idempotent |
| `homey_system_info` | Homey's own version, uptime, memory | `readOnly` |

Three things this surface does that the chat agent's tool definitions do not:

- **Pages, not dumps.** `getDevices()` answers with every capability value of all 84 devices. The
  list tools answer `{total, count, offset, limit, has_more, next_offset, items}` with summaries, and
  `homey_get_device` is what reports values.
- **Zone paths.** A device's `zone` is a UUID, and two rooms here are both called Kontor — one per
  floor. Every answer carries the full path, `Svinninge > Övervåning > Kontor`.
- **Advanced flows.** Half of this house's flows are advanced, and `manager/flow/flow/` lists none of
  them. `homey_list_flows` asks both endpoints and says which kind each flow is, and `homey_run_flow`
  triggers it through the matching one.

`homey_set_capability` and `homey_run_flow` are annotated `destructive` on purpose: they unlock doors
and switch off sockets, so a client should ask before calling them.

### Evaluation

`evaluations/homey_eval.xml` holds ten questions in the format Anthropic's MCP skill prescribes,
answered with read-only tools against the Homey in Svinninge on 2026-09-20. Re-measure after a
reorganisation of zones, devices or flows.

## OAuth2 Flow

The Homey API uses a 3-step token chain:

```
1. Browser login → Authorization Code
2. Code → Cloud Access Token + Refresh Token  (api.athom.com/oauth2/token)
3. Cloud Token → Delegation JWT               (api.athom.com/delegation/token)
4. Delegation JWT → Homey Session Token        (homey-local-ip/api/manager/users/login)
```

The session token is used for all local API calls. When tokens expire, they refresh automatically via the stored refresh token.

## Docker + Tailscale

The app deploys with a Tailscale sidecar container for secure remote access:

```bash
docker compose up -d --build   # Start / rebuild
docker compose down            # Stop
docker logs homey-chat         # App logs
docker logs homey-tailscale    # Tailscale logs
docker exec homey-tailscale tailscale status   # Tailscale network status
```

### Configuration

| Env variable | Description |
|---|---|
| `TS_AUTHKEY` | Tailscale auth key (stored in `.env.local`) |
| `BASE_URL` | OAuth2 redirect base URL, e.g. `https://homey-chat.example.ts.net` |
| `TS_SERVE_CONFIG` | Path to Tailscale Serve config (set automatically via volume mount) |

The `homey-chat` container shares Tailscale's network (`network_mode: "service:tailscale"`). Tailscale Serve proxies HTTPS (port 443) to the app on port 3000 — accessible at `https://<hostname>.ts.net` with a valid TLS certificate. OAuth2 tokens persist in a `./data/` volume.

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
├── version.json          # App version (auto-incremented on deploy)
├── Dockerfile            # Multi-stage Docker build
├── docker-compose.yml    # Docker + Tailscale deployment config
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
