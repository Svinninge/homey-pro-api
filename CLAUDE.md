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

- Tailscale sidecar container required (see `docker-compose.yml`)
- `homey-chat` shares Tailscale network via `network_mode: "service:tailscale"`
- Uses `TS_USERSPACE=true` for Docker Desktop on Windows
- Versioning: See global rules at `C:\Users\perno\OneDrive\Dokument\Claude\memory\versioning_rules.md`

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

## Conventions

- All code and comments in English
- Strict TypeScript, no `any`
- ESM modules (type: "module" in package.json)
- Minimal dependencies (Express is the only web framework)
- Single-user app — no multi-tenant session management
- High-contrast UI — no grey text on dark backgrounds (accessibility)
