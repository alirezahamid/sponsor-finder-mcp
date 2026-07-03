import { describe, expect, it } from 'vitest';

import { SponsorFinderClient } from '../src/api/client.js';
import { loadConfig } from '../src/config.js';
import { checkLicenseTool } from '../src/tools/check-license.js';
import { getSponsorDetailsTool } from '../src/tools/details.js';

/**
 * Live integration smoke test — hits the REAL SponsorFinder API.
 *
 * Gated on secrets so it is skipped by default (and in `pnpm test`, which
 * excludes this file). The real `.env` is only auto-loaded when the caller
 * exports the vars or runs the smoke runner with `node --env-file=.env`;
 * no key is ever hardcoded here.
 */
const RUN = !!process.env.SPONSORFINDER_API_KEY && !!process.env.SPONSORFINDER_API_BASE;

describe.skipIf(!RUN)('smoke', () => {
  const client = new SponsorFinderClient(loadConfig(process.env));

  it('returns register status for both countries with numeric totals', async () => {
    const status = await client.getStatus();
    expect(typeof status.uk.totalActive).toBe('number');
    expect(typeof status.nl.totalActive).toBe('number');
  }, 20_000);

  it('classifies a well-known UK sponsor as licensed', async () => {
    const result = await checkLicenseTool.handler(
      { company_name: 'google uk', country: 'uk' },
      { client },
    );
    expect(result.structuredContent?.verdict).toBe('licensed');
  }, 20_000);

  it('classifies gibberish as not_found', async () => {
    const result = await checkLicenseTool.handler(
      { company_name: 'xzqwptyblah', country: 'uk' },
      { client },
    );
    expect(result.structuredContent?.verdict).toBe('not_found');
  }, 20_000);

  it('classifies a broad common term as ambiguous', async () => {
    const result = await checkLicenseTool.handler(
      { company_name: 'consulting', country: 'uk' },
      { client },
    );
    expect(result.structuredContent?.verdict).toBe('ambiguous');
  }, 20_000);

  it('fetches details for a known UK org id', async () => {
    const result = await getSponsorDetailsTool.handler(
      { org_id: 45_456, country: 'uk', include_history: false },
      { client },
    );
    expect(result.structuredContent?.found).toBe(true);
  }, 20_000);
});
