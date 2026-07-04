import { z } from 'zod';

/**
 * Environment schema for the server.
 *
 * The config is parsed from a plain record so the exact same code runs on Node
 * (`process.env`) and Cloudflare Workers (`c.env`). No `node:` imports here —
 * this module is part of the Web-standard core.
 */

/** Parse a boolean-ish env string; only the literal "true" enables it. */
const boolFromEnv = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() === 'true');

const EnvSchema = z.object({
  SPONSORFINDER_API_BASE: z
    .string()
    .url('SPONSORFINDER_API_BASE must be a valid URL')
    // Normalise: drop any trailing slash so `${base}/organization/...` is clean.
    .transform((value) => value.replace(/\/+$/, '')),
  SPONSORFINDER_API_KEY: z.string().min(1, 'SPONSORFINDER_API_KEY is required'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),

  // --- Analytics (all optional; analytics are off unless both GA vars are set) ---
  GA_MEASUREMENT_ID: z.string().optional(),
  GA_API_SECRET: z.string().optional(),
  GA_DEBUG: boolFromEnv,
  // Opt-in: also record searched company names to the server's OWN structured
  // logs (never sent to GA). Off by default to keep queries private.
  CAPTURE_QUERY_NAMES: boolFromEnv,
});

export interface AnalyticsConfig {
  readonly measurementId: string;
  readonly apiSecret: string;
  readonly debug: boolean;
}

export interface AppConfig {
  readonly apiBase: string;
  readonly apiKey: string;
  readonly upstreamTimeoutMs: number;
  /** Present only when GA is fully configured; otherwise analytics are disabled. */
  readonly analytics: AnalyticsConfig | undefined;
  readonly captureQueryNames: boolean;
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

  const data = parsed.data;

  const analytics: AnalyticsConfig | undefined =
    data.GA_MEASUREMENT_ID && data.GA_API_SECRET
      ? {
          measurementId: data.GA_MEASUREMENT_ID,
          apiSecret: data.GA_API_SECRET,
          debug: data.GA_DEBUG,
        }
      : undefined;

  return {
    apiBase: data.SPONSORFINDER_API_BASE,
    apiKey: data.SPONSORFINDER_API_KEY,
    upstreamTimeoutMs: data.UPSTREAM_TIMEOUT_MS,
    analytics,
    captureQueryNames: data.CAPTURE_QUERY_NAMES,
  };
}
