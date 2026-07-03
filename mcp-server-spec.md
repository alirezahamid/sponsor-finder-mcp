# SponsorFinder MCP Server — Build Specification

Handoff document for scaffolding and implementing `sponsor-finder-mcp` in a **separate repository**.
The server lets AI assistants (Claude, ChatGPT, Cursor, …) check whether a company holds a
UK or Netherlands work-visa sponsorship licence, using the public SponsorFinder API.

---

## 1. Goals & constraints

- Read-only, **authless** remote MCP server (data is public). The upstream API key stays server-side.
- Two transports from day one:
  - **stdio** — local dev / Claude Desktop / Claude Code testing
  - **Streamable HTTP** — the deployed remote server (`https://mcp.sponsorfinder.io/mcp`)
- Two deployment targets kept open: **VPS Docker container** (primary) and **Cloudflare Workers**
  (fallback/scale-out). Achieved by using Hono + Web-standard `fetch` everywhere; only the entry
  files differ.
- Small: 4 tools, no database, no sessions, no OAuth. Stateless proxy with response shaping.
- Will be published to the official MCP registry (`registry.modelcontextprotocol.io`) and
  documented on sponsorfinder.io for manual "add custom connector" setup in claude.ai / ChatGPT.
- Anthropic Connectors Directory submission is deferred (requires Team/Enterprise org), but the
  server must already meet its technical bar: Streamable HTTP, `title` + `readOnlyHint: true`
  annotation on **every** tool.

## 2. Tech stack (latest verified versions, July 2026)

| Piece                   | Choice                      | Version                                         |
| ----------------------- | --------------------------- | ----------------------------------------------- | --- | --------------- |
| Language                | TypeScript, strict          | 5.x                                             |
| Runtime                 | Node.js LTS                 | 24.x (`v24.17.0` verified)                      |
| MCP SDK                 | `@modelcontextprotocol/sdk` | `1.29.0`                                        |
| HTTP framework          | `hono`                      | `4.12.27` (already a dependency of the MCP SDK) |
| MCP-over-Hono transport | `@hono/mcp`                 | `0.3.0` (works on Node AND Cloudflare Workers)  |
| Node server adapter     | `@hono/node-server`         | `1.19.x` (already a dependency of the MCP SDK)  |
| Validation              | `zod`                       | `4.4.3` (SDK supports `^3.25                    |     | ^4.0` — use v4) |
| Tests                   | `vitest`                    | `4.1.9`                                         |
| Build                   | `tsup`                      | `8.5.1`                                         |
| CF Workers CLI          | `wrangler`                  | `4.107.0`                                       |
| Package manager         | `pnpm`                      | 10.x                                            |

HTTP client: native `fetch` (Node 24 and Workers both have it). **No axios.**

## 3. Upstream API contract

Base URL (env `SPONSORFINDER_API_BASE`):

- Production: `https://www.sponsorfinder.io/api`
- Staging: use the staging host during development (same path shapes).

**Auth:** every request must send header `x-api-key: <FRONTEND_API_KEY>` (env
`SPONSORFINDER_API_KEY`). This key is a server-side secret of the MCP server — never expose it in
tool output, errors, or logs. MCP clients themselves connect authless.

All endpoints are `GET`, JSON responses. Validate every response with zod at the client boundary
and fail loudly on mismatch (contract-drift guard) — the upstream API is a separate repo.

### 3.1 `GET /organization/fuzzy` — typo-tolerant company search (primary endpoint)

Query params:

| Param      | Type                 | Notes                                                                |
| ---------- | -------------------- | -------------------------------------------------------------------- |
| `q`        | string, **required** | 2–100 chars. Trigram similarity search, tolerates typos ("microsft") |
| `country`  | `uk` \| `nl`         | default `uk`                                                         |
| `limit`    | int 1–50             | default 20                                                           |
| `minScore` | float 0–1            | default 0.2 (server-side). Lower = more recall                       |

Response `200`:

```json
{
  "data": [
    {
      "id": 73267,
      "name": "GOOGLE UK LIMITED",
      "totalRecords": 3,
      "isActive": true,
      "score": 0.62
    }
  ],
  "query": "google uk",
  "appliedThreshold": 0.2,
  "total": 1
}
```

- `score`: trigram similarity 0..1, higher = better. Results ordered by score desc.
- `isActive`: currently on the sponsor register (this is the licence verdict signal).
- NL quirk: `totalRecords` is always `0` for `country=nl` (column doesn't exist there).

### 3.2 `GET /organization/:id?country=uk|nl` — organization detail

`404` if not found (body: standard Nest error `{ "statusCode": 404, "message": "..." }`).

**UK response** (`country=uk` or omitted):

```json
{
  "id": 73267,
  "name": "GOOGLE UK LIMITED",
  "totalRecords": 3,
  "isActive": true,
  "firstSeenAt": "2023-01-04T00:00:00.000Z",
  "lastSeenAt": "2026-07-02T06:00:00.000Z",
  "created_at": "...",
  "updated_at": "...",
  "sector": "Information and communication",
  "sicCodes": [
    {
      "code": "62012",
      "description": "Business and domestic software development",
      "sector": "Information and communication",
      "section": "J"
    }
  ],
  "companiesHouseId": "03977902",
  "sponsorRecords": [
    {
      "id": 1,
      "organizationId": 73267,
      "typeRating": "Worker (A rating)",
      "route": "Skilled Worker",
      "isInCurrentCsv": true,
      "firstSeenAt": "...",
      "lastSeenAt": "...",
      "city": {
        "id": 1,
        "name": "London",
        "displayName": "London",
        "variations": ["london", "LONDON"]
      },
      "county": null
    }
  ],
  "cities": [{ "id": 1, "name": "London", "...": "..." }],
  "counties": [],
  "typeRatings": ["Worker (A rating)"],
  "routes": ["Skilled Worker", "Global Business Mobility: Senior or Specialist Worker"]
}
```

Notes for tool shaping:

- `sponsorRecords[].isInCurrentCsv` = this specific (route, rating, location) row is on the
  **current** Home Office register. `isActive` on the org = org appears on current register at all.
- `sector` / `sicCodes` / `companiesHouseId` may be `null` / `[]` (enrichment is best-effort).
- Deduplicated convenience arrays `cities`, `counties`, `typeRatings`, `routes` are present.

**NL response** (`country=nl`):

```json
{
  "id": 512,
  "name": "ASML Netherlands B.V.",
  "kvkNumber": "17085815",
  "sponsorType": "WORK",
  "firstSeenAt": "...",
  "lastSeenAt": "...",
  "country": "nl"
}
```

- `sponsorType` enum: `WORK | EXCHANGE | STUDY | RESEARCH`.
- NL detail has **no** `isActive` field — take activity from the fuzzy result instead, or treat
  presence with recent `lastSeenAt` as active. NL data is much thinner than UK (no
  ratings/routes/locations) — tool descriptions must say so, so the model doesn't overpromise.

### 3.3 `GET /organization/search` — filtered list search

Query params: `search`, `country`, `page`, `limit` (max 100), plus UK-only filters:
`cities` (comma-sep), `routes` (comma-sep), `typeRatings` (comma-sep), `sortBy`
(`name|firstSeenAt|lastSeenAt`), `sortOrder` (`asc|desc`); NL-only: `sponsorType`.

Response: `{ "data": [ <org objects, list shape without sponsorRecords> ], "meta": { "page": 1, "limit": 20, "total": 132, "totalPages": 7, "hasNext": true, "hasPrev": false } }`

Substring match (ILIKE) — use for exploration/filtering; use `/fuzzy` for name resolution.

### 3.4 `GET /organization/status` — data freshness + register stats

```json
{
  "uk": {
    "lastUpdated": "2026-07-02T06:00:01Z",
    "totalActive": 125798,
    "newLast7Days": 45,
    "removedLast7Days": 12,
    "reactivatedLast7Days": 3,
    "newLast30Days": 180,
    "removedLast30Days": 47
  },
  "nl": { "...": "same shape" }
}
```

### 3.5 `GET /organization/:id/history` — register change history (UK + NL orgs by id)

Params: `page`, `limit` (max 200). Response:

```json
{
  "orgId": 73267,
  "orgName": "GOOGLE UK LIMITED",
  "isActive": true,
  "firstSeenAt": "...",
  "events": [{ "eventType": "ADDED", "timestamp": "...", "runId": 42, "source": "uk" }],
  "total": 1,
  "page": 1,
  "totalPages": 1
}
```

`eventType` enum: `ADDED | REMOVED | REACTIVATED`.

### 3.6 `GET /organization/filters?country=uk|nl` — valid filter values

UK: object with available cities/routes/typeRatings (fetch once, cache; exact shape — inspect at
runtime). NL: `{ "sponsorTypes": ["WORK","EXCHANGE","STUDY","RESEARCH"] }`.
Use to validate/normalize `route` input in `search_sponsors` and to power the register-info tool.

---

## 4. MCP tools (exactly these 4)

Every tool: `title` + `annotations: { readOnlyHint: true }` (hard requirement — top directory
rejection cause). Every response includes both a human-readable `text` content block and
`structuredContent`. Every response embeds `data_as_of` (the `lastUpdated` value from `/status`,
cache it for ~10 min in-process) plus a one-line source note ("UK Home Office register of
licensed sponsors" / "Dutch IND public register of recognised sponsors").

### 4.1 `check_sponsor_license` — the primary tool

> Title: "Check Sponsorship Licence". Description: check whether a company holds a UK or
> Netherlands work-visa sponsorship licence. Handles typos and partial names. Returns licence
> routes, ratings, locations and register dates.

Input schema (zod):

```ts
{
  company_name: z.string().min(2).max(100)
    .describe('Company name, exact or approximate (typos OK)'),
  country: z.enum(['uk', 'nl', 'both']).default('both')
    .describe('Which register to check'),
}
```

Behaviour:

1. Call `/organization/fuzzy?q=<company_name>&country=<c>&limit=5` (both countries in parallel
   when `country=both`).
2. Classify:
   - **`licensed`** — top hit `score >= 0.55` AND `isActive === true`, and either a clear winner
     (top score − second score ≥ 0.15) or the top hit is an exact case-insensitive match.
     Fetch `/organization/:id` for the winner and include routes/ratings/locations (UK) or
     sponsorType/kvkNumber (NL).
   - **`formerly_licensed`** — same match confidence but `isActive === false`. Say when it was
     last seen on the register (`lastSeenAt`).
   - **`ambiguous`** — multiple plausible hits (scores close). Return the candidate list with
     scores + ids and instruct the model to ask the user or call `get_sponsor_details` on the
     right id. **Never silently pick a weak match.**
   - **`not_found`** — no hits above threshold. State clearly that absence from the register
     means the company cannot sponsor that visa type, and suggest checking spelling.
3. Text block example (licensed):

```
✅ GOOGLE UK LIMITED holds an active UK sponsorship licence.
Routes: Skilled Worker; Global Business Mobility: Senior or Specialist Worker
Rating: Worker (A rating)  |  Locations: London
On register since 2023-01-04. Match confidence: 0.92 (query: "google uk").
Data as of 2026-07-02 (UK Home Office register of licensed sponsors).
```

structuredContent mirror: `{ verdict, country, match: {...}, candidates: [...], data_as_of }`.

### 4.2 `search_sponsors`

> Title: "Search Sponsor Register". Exploratory list search with filters.

Input: `query` (string, optional), `country` (`uk|nl`, default `uk`), `city` (string, optional,
UK only), `route` (string, optional, UK only), `sponsor_type` (`WORK|EXCHANGE|STUDY|RESEARCH`,
optional, NL only), `limit` (int 1–20, default 10 — keep token budget small).

Maps to `/organization/search`. Returns compact list: `id`, `name`, `isActive`, plus UK
`totalRecords` / NL `sponsorType`, with `meta.total` so the model can report "132 matches,
showing 10". Include a hint in the description: "for checking one specific company, prefer
check_sponsor_license".

### 4.3 `get_sponsor_details`

> Title: "Get Sponsor Details". Full record for one organization by id.

Input: `org_id` (int), `country` (`uk|nl`, default `uk`), `include_history` (bool, default false).

Maps to `/organization/:id` (+ `/organization/:id/history?limit=20` when `include_history`).
UK: full shape from §3.2 minus raw `sponsorRecords` (return the deduplicated `routes`,
`typeRatings`, `cities`, `counties` arrays + per-record current/historical counts instead — raw
records with variations arrays waste tokens). NL: flat DTO as-is. 404 → clean "not found" text,
not an error throw.

### 4.4 `get_register_info`

> Title: "About the Sponsor Registers". Register stats, data freshness, and terminology.

Input: none (empty object schema).

Returns `/organization/status` (both countries) merged with a **static glossary** baked into the
server (this prevents hallucinated explanations):

- UK: what a sponsorship licence is; route meanings (Skilled Worker, Global Business Mobility
  variants, etc.); ratings ("A rating" = full compliance, "B rating" = transitional/action plan);
  registers update as the Home Office publishes new CSVs (checked daily);
  absence from the register = cannot sponsor.
- NL: IND recognised-sponsor register; `sponsorType` meanings (WORK = regular labour +
  highly-skilled migrants, STUDY, RESEARCH, EXCHANGE); NL register lists recognised sponsors
  only — far less detail than UK.
- Data disclaimer: informational, not legal advice; verify with official sources
  (gov.uk sponsor list / IND public register) before decisions.

---

## 5. Repository layout

```
sponsor-finder-mcp/
  package.json
  tsconfig.json
  tsup.config.ts
  wrangler.jsonc              # Cloudflare Workers config (deploy target 2)
  Dockerfile                  # VPS container (deploy target 1)
  .env.example                # SPONSORFINDER_API_BASE, SPONSORFINDER_API_KEY, PORT
  server.json                 # MCP registry manifest (mcp-publisher)
  src/
    server.ts                 # createServer(): McpServer + all 4 tool registrations (shared core)
    api/
      client.ts               # fetch wrapper: base URL + x-api-key + timeout + zod validation
      schemas.ts              # zod schemas for §3 responses
    tools/
      check-license.ts
      search.ts
      details.ts
      register-info.ts
    lib/
      verdict.ts              # match-classification logic (§4.1 step 2) — pure, unit-tested
      format.ts               # text rendering helpers
    entry/
      stdio.ts                # StdioServerTransport — for npx / Claude Desktop / local dev
      node.ts                 # Hono app + @hono/mcp + @hono/node-server — VPS container
      worker.ts               # same Hono app, `export default app` — Cloudflare Workers
  test/
    verdict.test.ts           # unit: classification thresholds, tie cases
    tools.test.ts             # unit: tools against mocked fetch
    smoke.test.ts             # integration: real staging API (CI, needs secrets)
```

Key principle: `src/server.ts` and everything under `src/tools/`, `src/api/`, `src/lib/` must be
**Web-standard only** (fetch, URL, no `node:` imports) so the same code runs on Node and Workers.
Only `entry/*.ts` files are platform-specific.

### Entry file sketches

```ts
// entry/node.ts  (VPS)
import { serve } from '@hono/node-server';
import { app } from './http-app.js'; // shared Hono app (below)
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) });

// entry/worker.ts (Cloudflare)
import { app } from './http-app.js';
export default app; // env vars come from wrangler vars/secrets

// shared http-app.ts
import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { createServer } from '../server.js';
export const app = new Hono();
app.get('/healthz', (c) => c.json({ ok: true }));
app.all('/mcp', async (c) => {
  const transport = new StreamableHTTPTransport();
  const server = createServer(c.env ?? process.env); // per-request on Workers; cheap, stateless
  await server.connect(transport);
  return transport.handleRequest(c);
});
```

(Adjust to the actual `@hono/mcp@0.3.0` API when implementing; the package exists for exactly
this dual-runtime purpose. On Workers, read `SPONSORFINDER_API_KEY` from a wrangler secret.)

Stateless mode: no session persistence needed — construct transport per request; all tools are
idempotent reads. If the SDK's session-id handshake causes client issues, enable its documented
stateless/sessionless option.

## 6. Config / env

| Var                      | Required | Notes                                                       |
| ------------------------ | -------- | ----------------------------------------------------------- |
| `SPONSORFINDER_API_BASE` | yes      | e.g. `https://www.sponsorfinder.io/api`                     |
| `SPONSORFINDER_API_KEY`  | yes      | upstream `x-api-key`. Secret — wrangler secret / Docker env |
| `PORT`                   | no       | Node entry only, default 3001                               |
| `UPSTREAM_TIMEOUT_MS`    | no       | default 10000, abort via `AbortSignal.timeout()`            |

## 7. Error handling & hardening

- Upstream 4xx/5xx or zod validation failure → tool returns `isError: true` content with a short
  honest message ("SponsorFinder API is temporarily unavailable"); never leak the API key, base
  URL internals, or stack traces into tool output.
- Upstream 429 → tell the model to retry later; do not auto-retry more than once.
- In-process caches (plain `Map`, TTL): `/status` 10 min, `/filters` 1 h. No Redis.
- Rate limiting is done at the edge (Caddy/nginx on VPS; Workers has built-in protections +
  optional rate-limit binding) — not in app code.
- Log one structured line per tool call (tool, latency, verdict, upstream status). No PII exists.

## 8. Deployment

### VPS container (primary)

- Multi-stage Dockerfile: `node:24-alpine`, `pnpm build` (tsup → `dist/`), run `dist/entry/node.js`
  as non-root. Image: `ghcr.io/alirezahamid/sponsor-finder-mcp`.
- Compose service on the existing VPS with `mem_limit: 128m`, `restart: unless-stopped`.
- Reverse proxy: `mcp.sponsorfinder.io` → container port; POST+GET+DELETE on `/mcp` must pass
  through, SSE-friendly (no response buffering: `proxy_buffering off` in nginx / default fine
  in Caddy).
- GitHub Actions: lint → typecheck → unit tests → build & push image on tag; smoke test job
  hits staging API with repo secrets.

### Cloudflare Workers (kept open)

- `wrangler.jsonc` with the worker entry, `wrangler secret put SPONSORFINDER_API_KEY`,
  route `mcp.sponsorfinder.io/*` (or a workers.dev URL first).
- Same code path — deployment is `wrangler deploy`, nothing else changes.

## 9. Local testing

- `pnpm dev:stdio` → test in Claude Code: `claude mcp add sponsorfinder -- node dist/entry/stdio.js`
  (or `--transport http http://localhost:3001/mcp` for the HTTP entry).
- MCP Inspector: `npx @modelcontextprotocol/inspector` against either transport.
- Acceptance checks (staging): `check_sponsor_license("Google", "uk")` → licensed;
  `check_sponsor_license("googel uk", "uk")` → licensed (typo path);
  `check_sponsor_license("ASML", "nl")` → licensed; nonsense string → not_found;
  a generic word like "consulting" → ambiguous with candidates.

## 10. Publishing (after deploy)

1. Official MCP registry: `mcp-publisher init` → fill `server.json` (name
   `io.sponsorfinder/mcp`, remote URL) → `mcp-publisher login` (domain/GitHub verification) →
   `mcp-publisher publish`.
2. sponsorfinder.io docs page: "Add SponsorFinder to Claude / ChatGPT" with the `/mcp` URL,
   plus privacy policy + support contact pages (prerequisites for any future Anthropic
   Connectors Directory submission, which needs a Team/Enterprise org).
3. README: tool list, example prompts, self-host instructions, licence (MIT), disclaimer.

## 11. Non-goals (v1)

- No OAuth, no per-user state, no write tools, no community-data endpoints, no bookmarks/jobs.
- No caching layer beyond in-process TTL maps.
- No support for the legacy SSE transport (Streamable HTTP + stdio only).
