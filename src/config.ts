import { z } from 'zod';

/**
 * Environment schema for the server.
 *
 * The config is parsed from a plain record so the exact same code runs on Node
 * (`process.env`) and Cloudflare Workers (`c.env`). No `node:` imports here —
 * this module is part of the Web-standard core.
 */
const EnvSchema = z.object({
  SPONSORFINDER_API_BASE: z
    .string()
    .url('SPONSORFINDER_API_BASE must be a valid URL')
    // Normalise: drop any trailing slash so `${base}/organization/...` is clean.
    .transform((value) => value.replace(/\/+$/, '')),
  SPONSORFINDER_API_KEY: z.string().min(1, 'SPONSORFINDER_API_KEY is required'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
});

export interface AppConfig {
  readonly apiBase: string;
  readonly apiKey: string;
  readonly upstreamTimeoutMs: number;
}

/**
 * Parse and validate configuration from an environment record.
 *
 * Throws a redacted error if required variables are missing — the error message
 * never echoes secret values.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration — ${issues}`);
  }

  return {
    apiBase: parsed.data.SPONSORFINDER_API_BASE,
    apiKey: parsed.data.SPONSORFINDER_API_KEY,
    upstreamTimeoutMs: parsed.data.UPSTREAM_TIMEOUT_MS,
  };
}
