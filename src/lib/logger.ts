/**
 * Structured logging — one JSON line per tool call (spec §7).
 *
 * Writes to stderr so it never corrupts the stdio MCP transport (which uses
 * stdout for protocol messages). No PII exists in this system, and secrets are
 * never passed in — callers log tool name, latency, verdict and upstream status
 * only.
 */

export interface ToolLogFields {
  tool: string;
  latencyMs: number;
  ok: boolean;
  verdict?: string | undefined;
  upstreamStatus?: number | undefined;
  errorKind?: string | undefined;
  /** Searched company name — only set when CAPTURE_QUERY_NAMES is enabled. */
  query?: string | undefined;
}

export function logToolCall(fields: ToolLogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: fields.ok ? 'info' : 'warn',
    msg: 'tool_call',
    ...fields,
  });
  // Structured operational log to stderr (stdout is the stdio transport).
  console.error(line);
}
