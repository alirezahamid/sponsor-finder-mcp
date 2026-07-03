# SponsorFinder MCP Server

An authless, read-only remote [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude, ChatGPT, Cursor, …) check whether a company holds a **UK** or **Netherlands** work-visa sponsorship licence. It proxies the public [SponsorFinder](https://sponsorfinder.io) API, shaping responses into clean verdicts, and keeps the upstream API key server-side so clients connect with no credentials.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node >=24](https://img.shields.io/badge/Node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Built with MCP](https://img.shields.io/badge/Built%20with-Model%20Context%20Protocol-6E56CF)](https://modelcontextprotocol.io)

## What it does

SponsorFinder tracks two official government registers of licensed work-visa sponsors:

- **UK** — the [Home Office register of licensed sponsors](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers), rebuilt from the CSVs the Home Office publishes (checked daily). Carries routes (e.g. Skilled Worker), ratings (A/B) and locations.
- **Netherlands** — the [IND public register of recognised sponsors](https://ind.nl/en/public-register-recognised-sponsors), checked daily. Lists recognised sponsors and their sponsor type (WORK / EXCHANGE / STUDY / RESEARCH); much thinner than the UK data — no routes, ratings, or locations.

This MCP server exposes that data as four tools. It is **read-only** and **authless for clients**: the upstream `x-api-key` is a server-side secret that MCP clients never see. There is no OAuth, no per-user state, and no write tools.

## Tools

| Tool                    | Title                       | What it does                                                                                                                                                                                                                          | Key inputs                                                                                                                                                                     |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check_sponsor_license` | Check Sponsorship Licence   | Primary tool. Resolves a company by name (typo-tolerant) and returns a verdict — `licensed`, `formerly_licensed`, `ambiguous`, or `not_found` — with routes, ratings, locations and register dates. Refuses to guess on weak matches. | `company_name` (2–100 chars, typos OK), `country` (`uk` \| `nl` \| `both`, default `both`)                                                                                     |
| `search_sponsors`       | Search Sponsor Register     | Exploratory list search with optional filters. Returns a compact list plus a total count. For one specific company, prefer `check_sponsor_license`.                                                                                   | `query?`, `country` (`uk` \| `nl`, default `uk`), `city?` (UK), `route?` (UK), `sponsor_type?` (NL: `WORK` \| `EXCHANGE` \| `STUDY` \| `RESEARCH`), `limit` (1–20, default 10) |
| `get_sponsor_details`   | Get Sponsor Details         | Full record for one organization by id: routes/ratings/locations/dates (UK) or sponsor type + KvK number (NL). Optionally includes register change history.                                                                           | `org_id` (int), `country` (`uk` \| `nl`, default `uk`), `include_history` (bool, default `false`)                                                                              |
| `get_register_info`     | About the Sponsor Registers | Register statistics, data freshness, a terminology glossary, and the legal disclaimer. Use it to explain what a licence, route, rating, or sponsor type means.                                                                        | none                                                                                                                                                                           |

Every tool is annotated `readOnlyHint: true` and returns both a human-readable text block and `structuredContent`, each stamped with the data-freshness date and a source note.

## Example prompts

Natural-language things you can ask an assistant once the server is connected:

- "Does Google hold a UK sponsorship licence?"
- "Is ASML a recognised sponsor in the Netherlands?"
- "Search UK Skilled Worker sponsors in Manchester."
- "List Dutch WORK-type sponsors matching 'shell'."
- "What does a B rating mean?"

**A note on name matching.** The fuzzy match tolerates typos (e.g. `googel uk`), but it needs a _reasonably complete_ name to resolve confidently — "Google UK" or "Google UK Limited" resolves cleanly, whereas a single bare word can match many companies. The server deliberately **refuses to guess on weak or tied matches**: instead of silently picking one, it returns an `ambiguous` verdict with the candidate list and asks you to disambiguate (or to call `get_sponsor_details` with the right id). Absence from a register is itself a meaningful answer: it means the company cannot currently sponsor that visa type.

## Use it (hosted)

The server is hosted at:

```
https://mcp.sponsorfinder.io/mcp
```

**Claude Code**

```bash
claude mcp add --transport http sponsorfinder https://mcp.sponsorfinder.io/mcp
```

**claude.ai** — Settings → Connectors → **Add custom connector** → paste the URL above. No authentication is required.

**ChatGPT** — Settings → Connectors (or a custom GPT's Actions) → **Add** a custom/remote MCP connector and paste the URL above.

Any MCP client that speaks Streamable HTTP can connect the same way — point it at `https://mcp.sponsorfinder.io/mcp`.

## Run locally

**Prerequisites:** Node.js 24 and pnpm 11.

```bash
pnpm install
cp .env.example .env
# then edit .env and fill in:
#   SPONSORFINDER_API_BASE   e.g. https://api.sponsorfinder.io
#   SPONSORFINDER_API_KEY    your upstream x-api-key (server-side secret)
```

Run one of the two transports in watch mode:

```bash
pnpm dev:stdio   # stdio transport (Claude Desktop / Claude Code / MCP Inspector)
pnpm dev:http    # Streamable HTTP on http://localhost:3001/mcp
```

**Add the local stdio build to Claude Code:**

```bash
pnpm build
claude mcp add sponsorfinder -- node dist/entry/stdio.js
```

**Inspect the tools interactively** with the MCP Inspector against either transport:

```bash
npx @modelcontextprotocol/inspector
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Name                     | Required | Default | Description                                                                                                             |
| ------------------------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `SPONSORFINDER_API_BASE` | yes      | —       | Base URL of the upstream SponsorFinder API, no trailing slash (e.g. `https://api.sponsorfinder.io`).                    |
| `SPONSORFINDER_API_KEY`  | yes      | —       | Upstream `x-api-key` header value. **Server-side secret — never exposed to MCP clients**, tool output, errors, or logs. |
| `PORT`                   | no       | `3001`  | HTTP port for the Node entry (`src/entry/node.ts`). Ignored by stdio and Cloudflare Workers.                            |
| `UPSTREAM_TIMEOUT_MS`    | no       | `10000` | Upstream request timeout in milliseconds (aborted via `AbortSignal.timeout()`).                                         |

`SPONSORFINDER_API_KEY` is the one true secret. MCP clients connect authless; the key lives only on the server (a Docker env var or a Cloudflare Workers secret) and is never surfaced to clients.

## Self-host / deploy

The Web-standard core runs on both Node and Cloudflare Workers; only the entry file differs.

**Docker (primary)** — image `ghcr.io/alirezahamid/sponsor-finder-mcp`, config in `Dockerfile` and `docker-compose.yml`:

```bash
docker compose up -d
```

Put a reverse proxy (Caddy/nginx) in front of `mcp.sponsorfinder.io` and pass **POST, GET and DELETE** through to `/mcp`. Streamable HTTP needs response **buffering off** (`proxy_buffering off;` in nginx; Caddy's defaults are fine).

**Cloudflare Workers** — config in `wrangler.jsonc`:

```bash
wrangler secret put SPONSORFINDER_API_KEY
pnpm deploy:worker
```

## Development

| Script            | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `pnpm typecheck`  | Type-check with `tsc --noEmit`.                                       |
| `pnpm lint`       | Lint with ESLint.                                                     |
| `pnpm test`       | Run unit tests (excludes smoke tests).                                |
| `pnpm test:smoke` | Integration smoke tests against the real staging API (needs secrets). |
| `pnpm build`      | Bundle to `dist/` with tsup.                                          |
| `pnpm check`      | `typecheck` + `lint` + `test` in one go.                              |

## How it works

The server is a thin, stateless proxy with response shaping. An MCP client connects over stdio or stateless Streamable HTTP; a small [Hono](https://hono.dev) app (with `@hono/mcp`) constructs an MCP server per request, calls the SponsorFinder API with the server-side key, validates every response with zod (a contract-drift guard), and shapes it into a compact verdict. Register stats and filter values are cached in-process with a short TTL. Because the core uses only Web-standard APIs (`fetch`, `URL`), the same code runs on Node and Cloudflare Workers — only `src/entry/*` differs.

```
MCP client (Claude / ChatGPT / Cursor)
        │  stdio  or  stateless Streamable HTTP
        ▼
SponsorFinder MCP server  (Hono + @hono/mcp)
   • 4 read-only tools, zod-validated
   • x-api-key added server-side
   • cached /status + /filters
        │  HTTPS  (x-api-key)
        ▼
SponsorFinder API  →  UK Home Office register + Dutch IND register
```

## Data & disclaimer

The data comes from the official [UK gov.uk register of licensed sponsors](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers) and the [Dutch IND public register of recognised sponsors](https://ind.nl/en/public-register-recognised-sponsors), refreshed daily.

This tool is **informational only and is not legal advice**. Register data can lag official publications, and a licence does not guarantee a company will sponsor any given role. Always verify against the official sources before making decisions.

## Contributing

Issues and pull requests are welcome at [github.com/alirezahamid/sponsor-finder-mcp](https://github.com/alirezahamid/sponsor-finder-mcp). Please run `pnpm check` before opening a PR.

> **Publishing note:** `server.json` is the manifest for the official MCP registry. Before running `mcp-publisher publish`, confirm the exact `$schema` URL against the current [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io) docs — the schema version pinned here may have moved on.

## License

[MIT](./LICENSE) © 2026 Alireza Hamid
