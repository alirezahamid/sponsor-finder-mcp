import { describe, expect, it } from 'vitest';

import type { FuzzyHit } from '../src/api/schemas.js';
import {
  CLEAR_WINNER_MARGIN,
  LICENSE_SCORE_THRESHOLD,
  classify,
} from '../src/lib/verdict.js';

function hit(overrides: Partial<FuzzyHit> = {}): FuzzyHit {
  return {
    id: 1,
    name: 'Acme Ltd',
    totalRecords: 5,
    isActive: true,
    score: 0.9,
    ...overrides,
  };
}

describe('classify', () => {
  it('exposes the documented threshold constants', () => {
    expect(LICENSE_SCORE_THRESHOLD).toBe(0.55);
    expect(CLEAR_WINNER_MARGIN).toBe(0.15);
  });

  it('returns not_found with no candidates for empty hits', () => {
    const result = classify('anything', []);
    expect(result.verdict).toBe('not_found');
    expect(result.match).toBeUndefined();
    expect(result.candidates).toEqual([]);
    expect(result.query).toBe('anything');
  });

  it('classifies a single confident active hit as licensed', () => {
    const result = classify('acme', [hit({ id: 7, isActive: true, score: 0.9 })]);
    expect(result.verdict).toBe('licensed');
    expect(result.match).toBeDefined();
    expect(result.match?.id).toBe(7);
    expect(result.match?.isActive).toBe(true);
    expect(result.candidates).toHaveLength(1);
  });

  it('classifies a single confident inactive hit as formerly_licensed', () => {
    const result = classify('acme', [hit({ id: 8, isActive: false, score: 0.9 })]);
    expect(result.verdict).toBe('formerly_licensed');
    expect(result.match?.id).toBe(8);
    expect(result.match?.isActive).toBe(false);
  });

  it('treats a single low-score hit as not_found but keeps the candidate', () => {
    const result = classify('acme', [hit({ id: 9, score: 0.4 })]);
    expect(result.verdict).toBe('not_found');
    expect(result.match).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.id).toBe(9);
  });

  it('treats a clear-winner margin of exactly 0.15 as licensed', () => {
    const result = classify('acme', [
      hit({ id: 1, name: 'Alpha Ltd', score: 0.75 }),
      hit({ id: 2, name: 'Beta Ltd', score: 0.6 }),
    ]);
    expect(result.verdict).toBe('licensed');
    expect(result.match?.id).toBe(1);
    expect(result.candidates).toHaveLength(2);
  });

  it('treats a margin of 0.14 (below the boundary) as ambiguous', () => {
    const result = classify('acme', [
      hit({ id: 1, name: 'Alpha Ltd', score: 0.74 }),
      hit({ id: 2, name: 'Beta Ltd', score: 0.6 }),
    ]);
    expect(result.verdict).toBe('ambiguous');
    expect(result.match).toBeUndefined();
    expect(result.candidates.map((c) => c.id)).toEqual([1, 2]);
  });

  it('promotes an exact case-insensitive name match to licensed without a clear margin', () => {
    const result = classify('ACME LTD', [
      hit({ id: 1, name: 'Acme Ltd', score: 0.6 }),
      hit({ id: 2, name: 'Acme Holdings Ltd', score: 0.58 }),
    ]);
    expect(result.verdict).toBe('licensed');
    expect(result.match?.id).toBe(1);
  });

  it('does not promote an exact name match whose score is below the threshold', () => {
    const result = classify('acme ltd', [hit({ id: 1, name: 'Acme Ltd', score: 0.5 })]);
    expect(result.verdict).toBe('not_found');
    expect(result.match).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
  });

  it('returns ambiguous for multiple close high-score hits', () => {
    const result = classify('consulting', [
      hit({ id: 1, name: 'Consulting One', score: 0.7 }),
      hit({ id: 2, name: 'Consulting Two', score: 0.65 }),
      hit({ id: 3, name: 'Consulting Three', score: 0.62 }),
    ]);
    expect(result.verdict).toBe('ambiguous');
    expect(result.match).toBeUndefined();
    expect(result.candidates).toHaveLength(3);
  });

  it('returns not_found when only low-score hits exist, retaining candidates sorted', () => {
    const result = classify('acme', [
      hit({ id: 1, name: 'Far One', score: 0.3 }),
      hit({ id: 2, name: 'Far Two', score: 0.2 }),
    ]);
    expect(result.verdict).toBe('not_found');
    expect(result.candidates.map((c) => c.score)).toEqual([0.3, 0.2]);
  });

  it('sorts candidates by score descending regardless of input order', () => {
    const result = classify('acme', [
      hit({ id: 1, name: 'Low', score: 0.2 }),
      hit({ id: 2, name: 'High', score: 0.9 }),
      hit({ id: 3, name: 'Mid', score: 0.5 }),
    ]);
    expect(result.candidates.map((c) => c.id)).toEqual([2, 3, 1]);
    // Top hit is a clear winner and active → licensed on the highest-scored item.
    expect(result.verdict).toBe('licensed');
    expect(result.match?.id).toBe(2);
  });

  it('handles the NL quirk of totalRecords === 0 on a confident hit', () => {
    const result = classify('dutch bv', [
      hit({ id: 42, name: 'Dutch BV', totalRecords: 0, isActive: true, score: 0.95 }),
    ]);
    expect(result.verdict).toBe('licensed');
    expect(result.match?.totalRecords).toBe(0);
    expect(result.candidates[0]?.totalRecords).toBe(0);
  });
});
