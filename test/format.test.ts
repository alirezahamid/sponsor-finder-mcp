import { describe, expect, it } from 'vitest';

import {
  COUNTRY_LABEL,
  SOURCE_NOTE,
  dataAsOfLine,
  formatDate,
  joinList,
  scoreText,
} from '../src/lib/format.js';

describe('formatDate', () => {
  it('reduces an ISO timestamp to YYYY-MM-DD', () => {
    expect(formatDate('2026-07-01T12:34:56.000Z')).toBe('2026-07-01');
  });

  it('accepts a plain YYYY-MM-DD string', () => {
    expect(formatDate('2026-07-01')).toBe('2026-07-01');
  });

  it('returns "unknown" for null or undefined', () => {
    expect(formatDate(null)).toBe('unknown');
    expect(formatDate(undefined)).toBe('unknown');
  });

  it('returns "unknown" for an empty or malformed string', () => {
    expect(formatDate('')).toBe('unknown');
    expect(formatDate('not-a-date')).toBe('unknown');
    expect(formatDate('2026/07/01')).toBe('unknown');
  });
});

describe('scoreText', () => {
  it('formats a score to two decimal places', () => {
    expect(scoreText(0.6)).toBe('0.60');
    expect(scoreText(0.925)).toBe('0.93');
    expect(scoreText(1)).toBe('1.00');
  });
});

describe('joinList', () => {
  it('returns an em dash for an empty list', () => {
    expect(joinList([])).toBe('—');
  });

  it('joins items with the default "; " separator', () => {
    expect(joinList(['a', 'b', 'c'])).toBe('a; b; c');
  });

  it('honours a custom separator', () => {
    expect(joinList(['a', 'b'], ', ')).toBe('a, b');
  });
});

describe('dataAsOfLine', () => {
  it('contains the formatted date and the source note', () => {
    const line = dataAsOfLine('2026-07-01T00:00:00.000Z', 'uk');
    expect(line).toContain('2026-07-01');
    expect(line).toContain(SOURCE_NOTE.uk);
    expect(line).toBe(`Data as of 2026-07-01 (${SOURCE_NOTE.uk}).`);
  });

  it('uses the NL source note for nl', () => {
    const line = dataAsOfLine('2026-07-01T00:00:00.000Z', 'nl');
    expect(line).toContain(SOURCE_NOTE.nl);
  });
});

describe('constants', () => {
  it('exposes the register source notes', () => {
    expect(SOURCE_NOTE.uk).toBe('UK Home Office register of licensed sponsors');
    expect(SOURCE_NOTE.nl).toBe('Dutch IND public register of recognised sponsors');
  });

  it('exposes the country labels', () => {
    expect(COUNTRY_LABEL.uk).toBe('UK');
    expect(COUNTRY_LABEL.nl).toBe('Netherlands');
  });
});
