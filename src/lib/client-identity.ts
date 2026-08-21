/**
 * Who is calling, and how do we count them.
 *
 * The hosted transport is stateless: `http-app.ts` builds a fresh `McpServer`
 * per request, so the instance handling `tools/call` never saw the `initialize`
 * that carried `clientInfo`. `getClientVersion()` therefore returns undefined on
 * HTTP (it works on stdio, where one server handles the whole session), which is
 * why `mcp_client` was 100% "(not set)" in GA4.
 *
 * The User-Agent is the only identity the request actually carries, so that is
 * what we use — normalised to a closed set, because raw UAs carry version
 * numbers and would explode GA4's cardinality for no analytical gain.
 */

export interface RequestIdentity {
  /** Normalised client name, or undefined when nothing identifiable was sent. */
  client?: string | undefined;
  /** Stable per-caller id. Same UA + IP yields the same value. */
  clientId: string;
}

const UNKNOWN_CLIENT_ID = 'unknown';

/**
 * Order matters: `mcp-remote` proxies other clients and mentions itself last, so
 * a more specific match must win first.
 */
const CLIENT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude/i, 'claude'],
  [/chatgpt|openai/i, 'chatgpt'],
  [/cursor/i, 'cursor'],
  [/windsurf/i, 'windsurf'],
  [/vscode|visual studio code/i, 'vscode'],
  [/mcp-remote/i, 'mcp-remote'],
  [/node|undici|python|curl/i, 'script'],
];

export function normaliseClient(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  for (const [pattern, name] of CLIENT_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return 'other';
}

/**
 * FNV-1a. Not cryptographic, and deliberately so — this only needs to be stable
 * and fast, and it runs on Workers where node:crypto is awkward.
 *
 * The IP is an input but never an output: only this digest is stored or sent.
 */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Derive a caller identity from request headers.
 *
 * Replaces the previous `crypto.randomUUID()` per `Ga4Analytics` instance, which
 * on the hosted transport meant one new "user" and one new "session" per HTTP
 * request — 607 tool calls reported as 607 users, and every session-scoped
 * metric on the property was an artifact.
 */
export function identifyRequest(headers: {
  get(name: string): string | null;
}): RequestIdentity {
  const userAgent = headers.get('user-agent') ?? undefined;
  // cf-connecting-ip on Workers; x-forwarded-for behind other proxies.
  const ip =
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '';

  const client = normaliseClient(userAgent);
  const fingerprint = `${userAgent ?? ''}|${ip}`;

  return {
    client,
    clientId: fingerprint === '|' ? UNKNOWN_CLIENT_ID : hash(fingerprint),
  };
}
