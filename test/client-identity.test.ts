import { describe, expect, it } from 'vitest';

import { identifyRequest, normaliseClient } from '../src/lib/client-identity.js';

const headers = (entries: Record<string, string>) => new Headers(entries);

describe('normaliseClient', () => {
  it.each([
    ['claude-ai/1.0', 'claude'],
    ['Claude Code 2.1 (macOS)', 'claude'],
    ['ChatGPT/1.2024.0', 'chatgpt'],
    ['openai-mcp/0.3', 'chatgpt'],
    ['Cursor/0.42.3', 'cursor'],
    ['Windsurf/1.0', 'windsurf'],
    ['node-fetch/3.3.2', 'script'],
    ['Mozilla/5.0 (compatible; SomeBot/1.0)', 'other'],
  ])('maps %s to %s', (userAgent, expected) => {
    expect(normaliseClient(userAgent)).toBe(expected);
  });

  it('returns undefined when no User-Agent was sent', () => {
    expect(normaliseClient(undefined)).toBeUndefined();
  });

  it('prefers the proxied client over the proxy itself', () => {
    // mcp-remote names itself alongside whatever it is proxying; the real
    // client is the useful attribution.
    expect(normaliseClient('claude-ai/1.0 (via mcp-remote/0.1)')).toBe('claude');
  });
});

describe('identifyRequest', () => {
  it('derives the client name from the User-Agent', () => {
    const identity = identifyRequest(headers({ 'user-agent': 'Cursor/0.42.3' }));
    expect(identity.client).toBe('cursor');
  });

  it('returns the same clientId for the same caller across requests', () => {
    // The whole point of the change: previously every request minted a fresh
    // UUID, so GA4 counted one "user" per tool call.
    const first = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'cf-connecting-ip': '203.0.113.7' }),
    );
    const second = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'cf-connecting-ip': '203.0.113.7' }),
    );
    expect(first.clientId).toBe(second.clientId);
  });

  it('separates different callers', () => {
    const a = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'cf-connecting-ip': '203.0.113.7' }),
    );
    const b = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'cf-connecting-ip': '198.51.100.4' }),
    );
    expect(a.clientId).not.toBe(b.clientId);
  });

  it('never returns the raw IP', () => {
    const identity = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'cf-connecting-ip': '203.0.113.7' }),
    );
    expect(identity.clientId).not.toContain('203.0.113.7');
  });

  it('falls back to x-forwarded-for behind a non-Cloudflare proxy', () => {
    const viaCf = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'cf-connecting-ip': '203.0.113.7' }),
    );
    const viaXff = identifyRequest(
      headers({ 'user-agent': 'claude-ai/1.0', 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }),
    );
    expect(viaXff.clientId).toBe(viaCf.clientId);
  });

  it('degrades to a constant id when the request carries no identity at all', () => {
    const identity = identifyRequest(headers({}));
    expect(identity.client).toBeUndefined();
    expect(identity.clientId).toBe('unknown');
  });
});
