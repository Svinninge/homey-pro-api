# Homey Pro API - Project Instructions

## Overview

TypeScript client, web chat UI, and Claude AI agent for controlling a Homey Pro smart home hub. Deployed in Docker with Tailscale networking.

## Architecture

- `src/server.ts` — Express web server (chat UI, OAuth2 web login, session/version API)
- `src/auth-web.ts` — OAuth2 flow adapted for web callbacks
- `src/auth.ts` — OAuth2 flow (CLI + shared helpers for token exchange)
- `src/homey-client.ts` — Lightweight REST client for Homey Pro local API
- `src/mcp.ts` — MCP server over stdio (tool contract, annotations, lazy Homey client)
- `src/mcp-format.ts` — Pure shaping for the MCP surface: pagination, zone paths, device summaries
- `src/mcp.test.ts`, `src/mcp-format.test.ts` — vitest against a fake Homey; no tokens needed
- `evaluations/homey_eval.xml` — ten read-only questions that measure the MCP surface
- `src/claude-tools.ts` — Tool definitions for Claude API tool-use
- `src/agent.ts` — Agentic loop that lets Claude control Homey autonomously
- `src/cli.ts` — CLI entry point for testing and interactive use
- `src/config.ts` — Environment config loader (supports BASE_URL for reverse proxy)
- `src/token-store.ts` — Token persistence and validation
- `public/index.html` — Chat UI (high-contrast theme, login + chat)
- `version.json` — App version, auto-incremented on deploy

## Commands

- Build: `npm run build`
- Web server: `npm run server` (production) / `npm run server:dev` (dev)
- CLI: `npm start -- <command>` (auth | ping | devices | zones | flows | ask)
- MCP server: `npm run mcp` (built) / `npm run mcp:dev` (TypeScript)
- Docker: `docker compose up -d --build`
- Test: `npm test`
- Lint: `npm run lint`

## Docker Deployment

- **Always deploy with the Tailscale sidecar container** (see `docker-compose.yml`); the app is
  reached only through Tailscale, so no public port mapping is needed.
- `homey-chat` shares the sidecar's network via `network_mode: "service:tailscale"` (Tailscale
  hostname `homey-chat`).
- Uses `TS_USERSPACE=true` for Docker Desktop on Windows (no `/dev/net/tun` there).
- HTTPS: Tailscale Serve proxies 443 to the app's port 3000 (`tailscale-serve.json`).
- `TS_AUTHKEY` and `BASE_URL` live only in `.env.local`, never in tracked files.
- Versioning: the maintainer's global versioning rules (project tag, file headers, `version.json`).

## Secrets

- Store in `.env.local` (gitignored)
- Copy `.env.example` to `.env.local` and fill in values
- `HOMEY_CLIENT_ID` — OAuth2 client ID from developer.athom.com
- `HOMEY_CLIENT_SECRET` — OAuth2 client secret
- `HOMEY_ADDRESS` — Local IP of Homey Pro (e.g., http://192.168.1.66)
- `ANTHROPIC_API_KEY` — Required for chat and agent mode
- `SESSION_SECRET` — Cookie signing secret for web UI
- `WEB_PORT` — Web server port (default: 3000)
- `TOKEN_FILE_PATH` — Token storage path (for Docker volumes)
- `TS_AUTHKEY` — Tailscale auth key for Docker sidecar
- `BASE_URL` — Override OAuth2 redirect base URL (for Tailscale/reverse proxy)

## MCP surface

`src/mcp.ts` is a surface, not a second implementation: it reuses `auth.ts` (the OAuth chain) and
`homey-client.ts`, exactly as the chat agent does. Rules for changing it:

- **Every tool states its `ToolAnnotations`.** `readOnly` for the five that only report;
  `homey_set_capability` and `homey_run_flow` are `destructive` because they unlock doors and switch
  off sockets. A client has nothing else to decide whether to ask the user first.
- **Tool names carry the `homey_` prefix** — the server runs alongside a dozen others in one client.
- **Lists page.** `{total, count, offset, limit, has_more, next_offset, items}`; `total` is `null`
  when the rows were cut short. `getDevices()` returns every value of all 84 devices, which is not
  something to hand a caller in one answer.
- **Zone paths, not zone ids.** Two rooms are called Kontor, one per floor.
- **Both flow kinds.** `manager/flow/flow/` lists standard flows only; advanced ones need
  `manager/flow/advancedflow/`, and triggering them uses that endpoint too.
- **Shaping goes in `mcp-format.ts`**, which is pure and therefore tested. The Homey is reached
  lazily, so `tools/list` works without tokens on disk.
- Advanced-flow triggering is implemented against `manager/flow/advancedflow/:id/trigger` but has not
  been confirmed against the real Homey yet — verify before relying on it.

## Which Homey token to use

| Type | Lifetime | Fits |
|---|---|---|
| OAuth2 session (this repo's flow: cloud token → delegation JWT → session) | about 1 h; renewing needs a browser login | server apps with a user in front of them |
| **API key** (my.homey.app → Settings → API Keys) | permanent, no refresh | embedded clients (ESP32), scheduled jobs |

Scopes for device control: `homey.device.readonly` + `homey.device.control`. The local API is plain
HTTP with `Authorization: Bearer <token>`; `GET /api/manager/system/ping` answers without auth. The
endpoint reference is `HomeyAPIV3Local.json` in the npm package `homey-api` — look it up there instead
of guessing. When the OAuth refresh answers `invalid_grant`, a new browser login is needed.

## Conventions

- All code and comments in English
- Strict TypeScript, no `any`
- ESM modules (type: "module" in package.json)
- Minimal dependencies (Express is the only web framework)
- Single-user app — no multi-tenant session management
- High-contrast UI — no grey text on dark backgrounds (accessibility)
