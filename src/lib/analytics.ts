import type { AnalyticsConfig } from '../config.js';

/**
 * GA4 Measurement Protocol tracker (server-side analytics).
 *
 * The MCP server has no browser, so we send events directly to GA4 over HTTP.
 * Web-standard only (`fetch`, `crypto.randomUUID`) so it runs on Node and
 * Cloudflare Workers alike.
 *
 * Privacy: events are strictly CATEGORICAL — tool name, verdict, country, client,
 * latency bucket, error kind. No company names or free-text queries are ever
 * sent here. Delivery is fire-and-forget: a failed or slow send never blocks or
 * breaks a tool call.
 */

const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const GA_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';
const SEND_TIMEOUT_MS = 3000;
export const TOOL_CALL_EVENT = 'mcp_tool_call';

export interface ToolEvent {
  tool: string;
  ok: boolean;
  latencyMs: number;
  country?: string | undefined;
  verdict?: string | undefined;
  mcpClient?: string | undefined;
  errorKind?: string | undefined;
}

/** Coarse latency buckets keep GA cardinality low and reports readable. */
export function latencyBucket(ms: number): string {
  if (ms < 100) return '0-100ms';
  if (ms < 300) return '100-300ms';
  if (ms < 1000) return '300-1000ms';
  if (ms < 3000) return '1000-3000ms';
  return '3000ms+';
}

export interface Analytics {
  track(event: ToolEvent): void;
}

/**
 * Keeps a background promise alive until it settles. On Cloudflare Workers this
 * must be `ctx.waitUntil`, otherwise a fire-and-forget send is cancelled once the
 * response returns. On Node it is unnecessary (the process outlives the request).
 */
export type WaitUntil = (promise: Promise<unknown>) => void;

/** No-op analytics used when GA is not configured. */
const NOOP: Analytics = { track() {} };

class Ga4Analytics implements Analytics {
  private readonly endpoint: string;
  // One synthetic client/session per process (there are no end users to identify).
  private readonly clientId = crypto.randomUUID();
  private readonly sessionId = crypto.randomUUID();

  constructor(
    config: AnalyticsConfig,
    private readonly waitUntil: WaitUntil | undefined,
  ) {
    const base = config.debug ? GA_DEBUG_ENDPOINT : GA_ENDPOINT;
    const params = new URLSearchParams({
      measurement_id: config.measurementId,
      api_secret: config.apiSecret,
    });
    this.endpoint = `${base}?${params.toString()}`;
  }

  track(event: ToolEvent): void {
    const payload = {
      client_id: this.clientId,
      events: [
        {
          name: TOOL_CALL_EVENT,
          params: {
            tool: event.tool,
            status: event.ok ? 'ok' : 'error',
            latency_bucket: latencyBucket(event.latencyMs),
            ...(event.country ? { country: event.country } : {}),
            ...(event.verdict ? { verdict: event.verdict } : {}),
            ...(event.mcpClient ? { mcp_client: event.mcpClient } : {}),
            ...(event.errorKind ? { error_kind: event.errorKind } : {}),
            // Required for GA4 to attribute the event to a session in reports.
            session_id: this.sessionId,
            engagement_time_msec: 1,
          },
        },
      ],
    };

    // Never await or throw into the caller. On Workers, hand the promise to
    // `waitUntil` so it survives past the response; on Node, fire-and-forget.
    const promise = this.send(payload);
    if (this.waitUntil) this.waitUntil(promise);
    else void promise;
  }

  private async send(payload: unknown): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      // Analytics must never affect tool behaviour — swallow all errors.
    }
  }
}

/**
 * Build an analytics sink; returns a no-op when GA is not configured.
 * Pass `waitUntil` on Cloudflare Workers so events survive past the response.
 */
export function createAnalytics(
  config: AnalyticsConfig | undefined,
  waitUntil?: WaitUntil,
): Analytics {
  return config ? new Ga4Analytics(config, waitUntil) : NOOP;
}
