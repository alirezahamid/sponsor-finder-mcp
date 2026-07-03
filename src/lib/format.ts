import type { Country } from '../api/schemas.js';

/** One-line provenance note per register (spec §4). */
export const SOURCE_NOTE: Record<Country, string> = {
  uk: 'UK Home Office register of licensed sponsors',
  nl: 'Dutch IND public register of recognised sponsors',
};

/** Human labels for a country code, used in prose. */
export const COUNTRY_LABEL: Record<Country, string> = {
  uk: 'UK',
  nl: 'Netherlands',
};

/** Format an ISO timestamp as a plain `YYYY-MM-DD` date, or `unknown`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const isoDate = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : 'unknown';
}

/** Two-decimal match-confidence string, e.g. `0.92`. */
export function scoreText(score: number): string {
  return score.toFixed(2);
}

/** Join a list for prose, falling back to an em dash when empty. */
export function joinList(items: readonly string[], separator = '; '): string {
  return items.length > 0 ? items.join(separator) : '—';
}

/** Trailing freshness + source line shared by every tool response. */
export function dataAsOfLine(lastUpdatedIso: string, country: Country): string {
  return `Data as of ${formatDate(lastUpdatedIso)} (${SOURCE_NOTE[country]}).`;
}
