import type { FuzzyHit } from '../api/schemas.js';

/**
 * Match-classification logic for `check_sponsor_license` (spec §4.1 step 2).
 *
 * Pure and side-effect free so it can be exhaustively unit-tested. It decides,
 * from a set of fuzzy hits, whether we can confidently name a single sponsor —
 * and, crucially, refuses to silently pick a weak match.
 */

/** Minimum trigram score for the top hit to be a confident match. */
export const LICENSE_SCORE_THRESHOLD = 0.55;

/** How far the top hit must lead the runner-up to be a "clear winner". */
export const CLEAR_WINNER_MARGIN = 0.15;

export type Verdict = 'licensed' | 'formerly_licensed' | 'ambiguous' | 'not_found';

export interface Candidate {
  id: number;
  name: string;
  score: number;
  isActive: boolean;
  totalRecords: number;
}

export interface Classification {
  verdict: Verdict;
  query: string;
  /** The confidently-identified organization (licensed / formerly_licensed). */
  match?: Candidate;
  /** All hits considered, best first — shown for `ambiguous` disambiguation. */
  candidates: Candidate[];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toCandidate(hit: FuzzyHit): Candidate {
  return {
    id: hit.id,
    name: hit.name,
    score: hit.score,
    isActive: hit.isActive,
    totalRecords: hit.totalRecords,
  };
}

/**
 * Classify fuzzy hits into a verdict.
 *
 * - `licensed` / `formerly_licensed`: top hit clears the score threshold and is
 *   either a clear winner or an exact (case-insensitive) name match. Active vs
 *   inactive splits the two.
 * - `ambiguous`: plausible hits exist but none is a confident winner.
 * - `not_found`: nothing clears the threshold.
 */
export function classify(query: string, hits: readonly FuzzyHit[]): Classification {
  const sorted = [...hits].sort((a, b) => b.score - a.score).map(toCandidate);

  if (sorted.length === 0) {
    return { verdict: 'not_found', query, candidates: [] };
  }

  const top = sorted[0]!;
  const second = sorted[1];

  const isExactMatch = normalizeName(top.name) === normalizeName(query);
  const isClearWinner =
    second === undefined || top.score - second.score >= CLEAR_WINNER_MARGIN;
  const isConfident =
    top.score >= LICENSE_SCORE_THRESHOLD && (isClearWinner || isExactMatch);

  if (isConfident) {
    return {
      verdict: top.isActive ? 'licensed' : 'formerly_licensed',
      query,
      match: top,
      candidates: sorted,
    };
  }

  // No confident winner. If any hit is at least plausible, ask to disambiguate
  // rather than guess. Otherwise report not found (candidates kept for spelling
  // suggestions).
  const hasPlausibleHit = sorted.some((c) => c.score >= LICENSE_SCORE_THRESHOLD);
  return {
    verdict: hasPlausibleHit ? 'ambiguous' : 'not_found',
    query,
    candidates: sorted,
  };
}
