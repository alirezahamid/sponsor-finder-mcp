import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';

import { createServer } from '../server.js';

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

app.get('/healthz', (c) => c.json({ ok: true, service: 'sponsor-finder-mcp' }));

app.all('/mcp', async (c) => {
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
});

// Never leak stack traces or internal paths to clients (spec §7).
app.onError((error, c) => {
  console.error(
    JSON.stringify({ level: 'error', msg: 'http_error', error: String(error) }),
  );
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});
