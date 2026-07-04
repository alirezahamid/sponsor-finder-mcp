import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SponsorFinderClient } from '../src/api/client.js';
import type { AppConfig } from '../src/config.js';
import {
  ContractDriftError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
} from '../src/lib/errors.js';
import type { FuzzyResponse, StatusResponse } from '../src/api/schemas.js';

const config: AppConfig = {
  apiBase: 'https://api.test',
  apiKey: 'test-key',
  upstreamTimeoutMs: 10_000,
  analytics: undefined,
  captureQueryNames: false,
};

const fuzzyBody: FuzzyResponse = {
  data: [{ id: 1, name: 'X', totalRecords: 0, isActive: true, score: 0.9 }],
  query: 'x',
  appliedThreshold: 0.2,
  total: 1,
};

function makeStats() {
  return {
    lastUpdated: '2026-07-01T00:00:00.000Z',
    totalActive: 12_345,
    newLast7Days: 10,
    removedLast7Days: 2,
    reactivatedLast7Days: 1,
    newLast30Days: 40,
    removedLast30Days: 9,
  };
}

const statusBody: StatusResponse = { uk: makeStats(), nl: makeStats() };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>;
}

describe('SponsorFinderClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the api key header and correct query params, returning the parsed body', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(fuzzyBody));
    const client = new SponsorFinderClient(config);

    const result = await client.fuzzy({ q: 'google', country: 'uk', limit: 5 });
    expect(result).toEqual(fuzzyBody);

    const call = fetchMock().mock.calls[0]!;
    const url = call[0] as string;
    const options = call[1] as RequestInit;
    expect(url).toContain('https://api.test/organization/fuzzy');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('google');
    expect(parsed.searchParams.get('country')).toBe('uk');
    expect(parsed.searchParams.get('limit')).toBe('5');
    expect(options.headers).toMatchObject({ 'x-api-key': 'test-key' });
  });

  it('maps a 404 response to NotFoundError', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ statusCode: 404, message: 'Not Found' }, 404),
    );
    const client = new SponsorFinderClient(config);
    await expect(client.fuzzy({ q: 'x', country: 'uk' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('maps a 429 response to RateLimitError', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ statusCode: 429, message: 'Too Many' }, 429),
    );
    const client = new SponsorFinderClient(config);
    await expect(client.fuzzy({ q: 'x', country: 'uk' })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('maps a 500 response to UpstreamError', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ statusCode: 500, message: 'Boom' }, 500),
    );
    const client = new SponsorFinderClient(config);
    await expect(client.fuzzy({ q: 'x', country: 'uk' })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it('throws ContractDriftError when the body fails schema validation', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ data: 'not-an-array', query: 'x' }));
    const client = new SponsorFinderClient(config);
    await expect(client.fuzzy({ q: 'x', country: 'uk' })).rejects.toBeInstanceOf(
      ContractDriftError,
    );
  });

  it('throws NetworkError when fetch rejects', async () => {
    fetchMock().mockRejectedValueOnce(new Error('connection reset'));
    const client = new SponsorFinderClient(config);
    await expect(client.fuzzy({ q: 'x', country: 'uk' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('caches getStatus so the second call does not hit fetch again', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(statusBody));
    const client = new SponsorFinderClient(config);

    const first = await client.getStatus();
    const second = await client.getStatus();

    expect(first).toEqual(statusBody);
    expect(second).toEqual(statusBody);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('never leaks the api key in any thrown error message', async () => {
    const client = new SponsorFinderClient(config);
    const responses: Array<() => void> = [
      () =>
        fetchMock().mockResolvedValueOnce(
          jsonResponse({ statusCode: 404, message: 'x' }, 404),
        ),
      () =>
        fetchMock().mockResolvedValueOnce(
          jsonResponse({ statusCode: 429, message: 'x' }, 429),
        ),
      () =>
        fetchMock().mockResolvedValueOnce(
          jsonResponse({ statusCode: 500, message: 'x' }, 500),
        ),
      () => fetchMock().mockResolvedValueOnce(jsonResponse({ data: 'bad' })),
      () => fetchMock().mockRejectedValueOnce(new Error('boom')),
    ];

    const errors: unknown[] = [];
    for (const arrange of responses) {
      fetchMock().mockReset();
      arrange();
      try {
        await client.fuzzy({ q: 'x', country: 'uk' });
        throw new Error('expected the request to throw');
      } catch (error) {
        errors.push(error);
      }
    }

    expect(errors).toHaveLength(responses.length);
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      const err = error as { message: string; toClientMessage?: () => string };
      expect(err.message).not.toContain('test-key');
      if (typeof err.toClientMessage === 'function') {
        expect(err.toClientMessage()).not.toContain('test-key');
      }
    }
  });
});
