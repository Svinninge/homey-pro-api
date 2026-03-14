# Homey Pro API - Project Instructions

## Overview

TypeScript client, web chat UI, and Claude AI agent for controlling a Homey Pro smart home hub. Deployed in Docker with Tailscale networking.

## Architecture

- `src/server.ts` — Express web server (chat UI, OAuth2 web login, session/version API)
- `src/auth-web.ts` — OAuth2 flow adapted for web callbacks
- `src/auth.ts` — OAuth2 flow (CLI + shared helpers for token exchange)
- `src/homey-client.ts` — Lightweight REST client for Homey Pro local API
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

## Conventions

- All code and comments in English
- Strict TypeScript, no `any`
- ESM modules (type: "module" in package.json)
- Minimal dependencies (Express is the only web framework)
- Single-user app — no multi-tenant session management
- High-contrast UI — no grey text on dark backgrounds (accessibility)
