import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { createServer } from '../server.js';

/** Canonical MCP endpoint path advertised everywhere. */
export const MCP_PATH = '/mcp';

/** Public source + docs links surfaced on the landing page. */
export const REPO_URL = 'https://github.com/alirezahamid/sponsor-finder-mcp';
export const DOCS_URL =
  'https://github.com/alirezahamid/sponsor-finder-mcp/blob/main/docs/README.md';

/**
 * Shared Hono app used by both the Node (VPS) and Cloudflare Workers entries.
 *
 * Stateless Streamable HTTP: a fresh transport + MCP server is created per
 * request (all tools are idempotent reads, so there is no session to persist).
 * The underlying API client — and its TTL caches — is memoised per config
 * inside `createServer`, so caching survives across requests.
 */
type Env = Record<string, string | undefined>;

export const app = new Hono<{ Bindings: Env }>();

const processEnv: Env = typeof process !== 'undefined' ? (process.env as Env) : {};

/**
 * Resolve the config environment. On Cloudflare Workers, secrets and vars live
 * on `c.env`. On `@hono/node-server`, `c.env` is instead the Node request/response
 * binding (it has keys but not our vars), so we only trust it when it actually
 * carries our config; otherwise we fall back to `process.env`.
 */
function resolveEnv(cEnv: Env | undefined): Env {
  if (cEnv && typeof cEnv.SPONSORFINDER_API_KEY === 'string') return cEnv;
  return processEnv;
}

/** Handle one MCP request over stateless Streamable HTTP. */
async function handleMcp(c: Context<{ Bindings: Env }>): Promise<Response | undefined> {
  // On Workers, hand background work (analytics) to waitUntil so it isn't
  // cancelled when the response returns. On Node the getter throws — ignore.
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  try {
    waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
  } catch {
    waitUntil = undefined;
  }

  const server = createServer(resolveEnv(c.env), { waitUntil });
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
}

app.get('/healthz', (c) => c.json({ ok: true, service: 'sponsor-finder-mcp' }));

// Human-friendly landing so visiting the domain in a browser explains itself
// instead of returning a bare 404.
app.get('/', (c) =>
  c.json({
    name: 'Sponsor Finder MCP server',
    description:
      'Check whether a company holds a UK or Netherlands work-visa sponsorship licence.',
    mcp_endpoint: new URL(MCP_PATH, c.req.url).toString(),
    docs: DOCS_URL,
    repository: REPO_URL,
    health: new URL('/healthz', c.req.url).toString(),
  }),
);

app.all(MCP_PATH, handleMcp);

// Tolerate connectors configured with the bare host (no `/mcp`): route the MCP
// protocol methods on `/` to the same handler. GET `/` stays the landing page.
app.on(['POST', 'DELETE'], '/', handleMcp);

// Never leak stack traces or internal paths to clients (spec §7).
app.onError((error, c) => {
  console.error(
    JSON.stringify({ level: 'error', msg: 'http_error', error: String(error) }),
  );
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});
