import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyticsConfig } from '../src/config.js';
import { TOOL_CALL_EVENT, createAnalytics, latencyBucket } from '../src/lib/analytics.js';

const gaConfig: AnalyticsConfig = {
  measurementId: 'G-TEST123',
  apiSecret: 'secret-abc',
  debug: false,
};

describe('latencyBucket', () => {
  it.each([
    [10, '0-100ms'],
    [150, '100-300ms'],
    [500, '300-1000ms'],
    [2000, '1000-3000ms'],
    [9000, '3000ms+'],
  ])('buckets %ims as %s', (ms, expected) => {
    expect(latencyBucket(ms)).toBe(expected);
  });
});

describe('createAnalytics', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is a no-op when GA is not configured (no fetch)', () => {
    const analytics = createAnalytics(undefined);
    analytics.track({ tool: 'check_sponsor_license', ok: true, latencyMs: 42 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs a categorical GA4 event to the MP endpoint', async () => {
    const analytics = createAnalytics(gaConfig);
    analytics.track({
      tool: 'check_sponsor_license',
      ok: true,
      latencyMs: 120,
      country: 'uk',
      verdict: 'licensed',
      mcpClient: 'claude-ai',
    });
    // Allow the fire-and-forget microtask to run.
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('https://www.google-analytics.com/mp/collect');
    expect(url).toContain('measurement_id=G-TEST123');
    expect(url).toContain('api_secret=secret-abc');

    const body = JSON.parse(init.body as string);
    expect(body.client_id).toBeTruthy();
    expect(body.events[0].name).toBe(TOOL_CALL_EVENT);
    const params = body.events[0].params;
    expect(params).toMatchObject({
      tool: 'check_sponsor_license',
      status: 'ok',
      latency_bucket: '100-300ms',
      country: 'uk',
      verdict: 'licensed',
      mcp_client: 'claude-ai',
    });
    expect(params.session_id).toBeTruthy();
  });

  it('never sends free-text company names (categorical only)', async () => {
    const analytics = createAnalytics(gaConfig);
    analytics.track({
      tool: 'check_sponsor_license',
      ok: true,
      latencyMs: 50,
      country: 'uk',
    });
    await Promise.resolve();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const serialized = init.body as string;
    expect(serialized).not.toMatch(/company_name|query/i);
  });

  it('uses the debug endpoint when debug is on', async () => {
    const analytics = createAnalytics({ ...gaConfig, debug: true });
    analytics.track({ tool: 'get_register_info', ok: true, latencyMs: 5 });
    await Promise.resolve();

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('/debug/mp/collect');
  });

  it('swallows fetch failures (never throws into caller)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const analytics = createAnalytics(gaConfig);
    expect(() =>
      analytics.track({
        tool: 'search_sponsors',
        ok: false,
        latencyMs: 10,
        errorKind: 'upstream',
      }),
    ).not.toThrow();
    await Promise.resolve();
  });
});
