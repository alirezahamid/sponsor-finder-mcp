/**
 * Typed error hierarchy for the upstream API boundary.
 *
 * These errors carry only information that is SAFE to surface to an MCP client.
 * They never contain the API key, the upstream base URL, request headers, or
 * raw stack traces. `toClientMessage()` renders the honest, non-leaky text that
 * tools put in their `isError` responses.
 */

export type UpstreamErrorKind =
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'contract_drift'
  | 'upstream'
  | 'network';

export abstract class SponsorFinderError extends Error {
  abstract readonly kind: UpstreamErrorKind;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  /** Short, user-safe message for tool output. Overridable per subclass. */
  toClientMessage(): string {
    return this.message;
  }
}

/** Upstream returned 404 — the organization id does not exist. */
export class NotFoundError extends SponsorFinderError {
  readonly kind = 'not_found';
  constructor(message = 'Organization not found.') {
    super(message);
  }
}

/** Upstream returned 429 — caller should back off. */
export class RateLimitError extends SponsorFinderError {
  readonly kind = 'rate_limited';
  constructor() {
    super('The SponsorFinder API is rate-limiting requests. Please retry in a moment.');
  }
}

/** The request exceeded UPSTREAM_TIMEOUT_MS and was aborted. */
export class TimeoutError extends SponsorFinderError {
  readonly kind = 'timeout';
  constructor() {
    super('The SponsorFinder API took too long to respond. Please try again.');
  }
  override toClientMessage(): string {
    return 'The SponsorFinder API is temporarily unavailable (timed out). Please try again.';
  }
}

/** A response did not match the expected schema (contract drift). */
export class ContractDriftError extends SponsorFinderError {
  readonly kind = 'contract_drift';
  constructor(endpoint: string, detail: string) {
    super(`Unexpected response shape from ${endpoint}: ${detail}`);
  }
  override toClientMessage(): string {
    return 'The SponsorFinder API returned an unexpected response. Please try again later.';
  }
}

/** Any other non-2xx upstream status (4xx/5xx). */
export class UpstreamError extends SponsorFinderError {
  readonly kind = 'upstream';
  readonly status: number;
  constructor(status: number) {
    super(`Upstream request failed with status ${status}.`);
    this.status = status;
  }
  override toClientMessage(): string {
    return 'The SponsorFinder API is temporarily unavailable. Please try again later.';
  }
}

/** Network-level failure (DNS, connection reset, fetch threw). */
export class NetworkError extends SponsorFinderError {
  readonly kind = 'network';
  constructor() {
    super('Could not reach the SponsorFinder API.');
  }
  override toClientMessage(): string {
    return 'The SponsorFinder API is temporarily unavailable. Please try again later.';
  }
}

/**
 * Map any thrown value to a safe client-facing message. Unknown errors collapse
 * to a generic string so internal details never leak into tool output.
 */
export function toSafeMessage(error: unknown): string {
  if (error instanceof SponsorFinderError) {
    return error.toClientMessage();
  }
  return 'The SponsorFinder API is temporarily unavailable. Please try again later.';
}
