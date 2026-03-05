# Homey Pro API - Project Instructions

## Overview

TypeScript client and Claude AI agent for controlling Homey Pro smart home hub.

## Architecture

- `src/homey-client.ts` — Lightweight REST client for Homey Pro local API
- `src/claude-tools.ts` — Tool definitions for Claude API tool-use
- `src/agent.ts` — Agentic loop that lets Claude control Homey autonomously
- `src/cli.ts` — CLI entry point for testing and interactive use
- `src/config.ts` — Environment config loader

## Commands

- Build: `npm run build`
- Dev: `npm run dev` (watch mode with tsx)
- Run: `npm start -- <command>` (ping | devices | zones | flows | ask <question>)
- Test: `npm test`
- Lint: `npm run lint`

## Secrets

- Store in `.env.local` (gitignored)
- Copy `.env.example` to `.env.local` and fill in values
- `HOMEY_ADDRESS` — Local IP of Homey Pro (e.g., http://192.168.1.100)
- `HOMEY_API_TOKEN` — API key from Homey Settings > API Keys
- `ANTHROPIC_API_KEY` — Only needed for agent/ask mode

## Conventions

- All code and comments in English
- Strict TypeScript, no `any`
- ESM modules (type: "module" in package.json)
- Minimal dependencies
