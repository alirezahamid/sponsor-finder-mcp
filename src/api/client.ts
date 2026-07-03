import type { z } from 'zod';

import type { AppConfig } from '../config.js';
import {
  ContractDriftError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  UpstreamError,
} from '../lib/errors.js';
import { TtlCache } from './cache.js';
import {
  type Country,
  FuzzyResponseSchema,
  HistoryResponseSchema,
  NlFiltersSchema,
  NlOrganizationSchema,
  SearchResponseSchema,
  StatusResponseSchema,
  UkFiltersSchema,
  UkOrganizationSchema,
  type FuzzyResponse,
  type HistoryResponse,
  type NlFilters,
  type NlOrganization,
  type SearchResponse,
  type StatusResponse,
  type UkFilters,
  type UkOrganization,
} from './schemas.js';

const STATUS_TTL_MS = 10 * 60 * 1000; // §7: /status cached ~10 min
const FILTERS_TTL_MS = 60 * 60 * 1000; // §7: /filters cached ~1 h

export interface FuzzyParams {
  q: string;
  country: Country;
  limit?: number | undefined;
  minScore?: number | undefined;
}

export interface SearchParams {
  search?: string | undefined;
  country: Country;
  page?: number | undefined;
  limit?: number | undefined;
  cities?: string | undefined;
  routes?: string | undefined;
  typeRatings?: string | undefined;
  sponsorType?: string | undefined;
  sortBy?: string | undefined;
  sortOrder?: string | undefined;
}

/**
 * Thin, stateless client for the SponsorFinder API.
 *
 * Every response is validated with Zod at this boundary; a mismatch throws
 * `ContractDriftError` (spec §3). The API key is attached here and never leaves
 * this module — it is not included in any thrown error or return value.
 */
export class SponsorFinderClient {
  private readonly statusCache = new TtlCache<StatusResponse>(STATUS_TTL_MS);
  private readonly filtersCache = new TtlCache<UkFilters | NlFilters>(FILTERS_TTL_MS);

  constructor(private readonly config: AppConfig) {}

  // -- Public API ----------------------------------------------------------

  fuzzy(params: FuzzyParams): Promise<FuzzyResponse> {
    return this.request('/organization/fuzzy', FuzzyResponseSchema, {
      q: params.q,
      country: params.country,
      limit: params.limit,
      minScore: params.minScore,
    });
  }

  getUkOrganization(id: number): Promise<UkOrganization> {
    return this.request(`/organization/${id}`, UkOrganizationSchema, { country: 'uk' });
  }

  getNlOrganization(id: number): Promise<NlOrganization> {
    return this.request(`/organization/${id}`, NlOrganizationSchema, { country: 'nl' });
  }

  search(params: SearchParams): Promise<SearchResponse> {
    return this.request('/organization/search', SearchResponseSchema, { ...params });
  }

  getHistory(id: number, limit = 20): Promise<HistoryResponse> {
    return this.request(`/organization/${id}/history`, HistoryResponseSchema, { limit });
  }

  /** `/status`, cached ~10 min. Powers the `data_as_of` freshness stamp. */
  getStatus(): Promise<StatusResponse> {
    return this.statusCache.getOrLoad('status', () =>
      this.request('/organization/status', StatusResponseSchema, {}),
    );
  }

  /** UK `/filters`, cached ~1 h. */
  async getUkFilters(): Promise<UkFilters> {
    const value = await this.filtersCache.getOrLoad('filters:uk', () =>
      this.request('/organization/filters', UkFiltersSchema, { country: 'uk' }),
    );
    return value as UkFilters;
  }

  /** NL `/filters`, cached ~1 h. */
  async getNlFilters(): Promise<NlFilters> {
    const value = await this.filtersCache.getOrLoad('filters:nl', () =>
      this.request('/organization/filters', NlFiltersSchema, { country: 'nl' }),
    );
    return value as NlFilters;
  }

  // -- Internals -----------------------------------------------------------

  private buildUrl(path: string, query: Record<string, unknown>): string {
    const url = new URL(this.config.apiBase + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      // Only primitive query values are supported; ignore anything else.
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, unknown>,
  ): Promise<T> {
    const url = this.buildUrl(path, query);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.config.apiKey,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.config.upstreamTimeoutMs),
      });
    } catch (error) {
      // AbortSignal.timeout aborts with a TimeoutError DOMException.
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new TimeoutError();
      }
      throw new NetworkError();
    }

    if (!response.ok) {
      // Drain the body so the connection can be reused; we deliberately do not
      // forward upstream error text to the client (it may echo the request).
      await response.text().catch(() => undefined);
      if (response.status === 404) throw new NotFoundError();
      if (response.status === 429) throw new RateLimitError();
      throw new UpstreamError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ContractDriftError(path, 'response was not valid JSON');
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ContractDriftError(
        path,
        parsed.error.issues[0]?.message ?? 'schema mismatch',
      );
    }
    return parsed.data;
  }
}
