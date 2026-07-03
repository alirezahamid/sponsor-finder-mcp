import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SponsorFinderClient } from '../src/api/client.js';
import type {
  FuzzyResponse,
  NlOrganization,
  RegisterStats,
  SearchResponse,
  StatusResponse,
  UkOrganization,
} from '../src/api/schemas.js';
import { NotFoundError } from '../src/lib/errors.js';
import { DISCLAIMER } from '../src/lib/glossary.js';
import { checkLicenseTool } from '../src/tools/check-license.js';
import { getRegisterInfoTool } from '../src/tools/register-info.js';
import { getSponsorDetailsTool } from '../src/tools/details.js';
import { searchSponsorsTool } from '../src/tools/search.js';

function makeStats(): RegisterStats {
  return {
    lastUpdated: '2026-07-01T00:00:00.000Z',
    totalActive: 12_345,
    newLast7Days: 10,
    removedLast7Days: 2,
    reactivatedLast7Days: 1,
    newLast30Days: 40,
    removedLast30Days: 9,
  };
}

const status: StatusResponse = { uk: makeStats(), nl: makeStats() };

const ukOrg: UkOrganization = {
  id: 1,
  name: 'Acme Ltd',
  totalRecords: 5,
  isActive: true,
  firstSeenAt: '2020-01-01T00:00:00.000Z',
  lastSeenAt: '2026-06-30T00:00:00.000Z',
  sector: 'Technology',
  sicCodes: [],
  companiesHouseId: '12345678',
  sponsorRecords: [
    {
      id: 10,
      typeRating: 'Worker (A rating)',
      route: 'Skilled Worker',
      isInCurrentCsv: true,
      firstSeenAt: '2020-01-01T00:00:00.000Z',
      lastSeenAt: '2026-06-30T00:00:00.000Z',
    },
  ],
  cities: [{ id: 1, name: 'London' }],
  counties: [],
  typeRatings: ['Worker (A rating)'],
  routes: ['Skilled Worker'],
};

const nlOrg: NlOrganization = {
  id: 2,
  name: 'Dutch BV',
  kvkNumber: '87654321',
  sponsorType: 'WORK',
  firstSeenAt: '2021-01-01T00:00:00.000Z',
  lastSeenAt: '2026-06-30T00:00:00.000Z',
  isActive: true,
};

interface FakeClient {
  fuzzy: ReturnType<typeof vi.fn>;
  getUkOrganization: ReturnType<typeof vi.fn>;
  getNlOrganization: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  getHistory: ReturnType<typeof vi.fn>;
}

let fake: FakeClient;
let client: SponsorFinderClient;

beforeEach(() => {
  fake = {
    fuzzy: vi.fn(),
    getUkOrganization: vi.fn(),
    getNlOrganization: vi.fn(),
    getStatus: vi.fn().mockResolvedValue(status),
    search: vi.fn(),
    getHistory: vi.fn(),
  };
  client = fake as unknown as SponsorFinderClient;
});

describe('check_sponsor_license', () => {
  it('returns licensed with a ✅ block and structured verdict for a strong active UK hit', async () => {
    const fuzzy: FuzzyResponse = {
      data: [{ id: 1, name: 'Acme Ltd', totalRecords: 5, isActive: true, score: 0.95 }],
      query: 'acme',
      appliedThreshold: 0.2,
      total: 1,
    };
    fake.fuzzy.mockResolvedValue(fuzzy);
    fake.getUkOrganization.mockResolvedValue(ukOrg);

    const result = await checkLicenseTool.handler(
      { company_name: 'acme', country: 'uk' },
      { client },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.verdict).toBe('licensed');
    expect(result.content[0]?.text).toContain('✅');
    expect(result.content[0]?.text).toContain('Acme Ltd');
    expect(fake.getUkOrganization).toHaveBeenCalledWith(1);
    const match = result.structuredContent?.match as { name: string; isActive: boolean };
    expect(match.name).toBe('Acme Ltd');
    expect(match.isActive).toBe(true);
  });

  it('returns ambiguous for close hits without fetching organization detail', async () => {
    const fuzzy: FuzzyResponse = {
      data: [
        { id: 1, name: 'Consulting One', totalRecords: 3, isActive: true, score: 0.7 },
        { id: 2, name: 'Consulting Two', totalRecords: 2, isActive: true, score: 0.66 },
      ],
      query: 'consulting',
      appliedThreshold: 0.2,
      total: 2,
    };
    fake.fuzzy.mockResolvedValue(fuzzy);

    const result = await checkLicenseTool.handler(
      { company_name: 'consulting', country: 'uk' },
      { client },
    );

    expect(result.structuredContent?.verdict).toBe('ambiguous');
    expect(fake.getUkOrganization).not.toHaveBeenCalled();
  });

  it('returns not_found when there are no hits', async () => {
    const fuzzy: FuzzyResponse = {
      data: [],
      query: 'zzz',
      appliedThreshold: 0.2,
      total: 0,
    };
    fake.fuzzy.mockResolvedValue(fuzzy);

    const result = await checkLicenseTool.handler(
      { company_name: 'zzzxqwer', country: 'uk' },
      { client },
    );

    expect(result.structuredContent?.verdict).toBe('not_found');
  });

  it('resolves the NL path and exposes sponsorType', async () => {
    const fuzzy: FuzzyResponse = {
      data: [{ id: 2, name: 'Dutch BV', totalRecords: 0, isActive: true, score: 0.95 }],
      query: 'dutch bv',
      appliedThreshold: 0.2,
      total: 1,
    };
    fake.fuzzy.mockResolvedValue(fuzzy);
    fake.getNlOrganization.mockResolvedValue(nlOrg);

    const result = await checkLicenseTool.handler(
      { company_name: 'dutch bv', country: 'nl' },
      { client },
    );

    expect(result.structuredContent?.verdict).toBe('licensed');
    const match = result.structuredContent?.match as { sponsorType: string };
    expect(match.sponsorType).toBe('WORK');
    expect(fake.getNlOrganization).toHaveBeenCalledWith(2);
  });
});

describe('search_sponsors', () => {
  it('returns the compact list plus total', async () => {
    const searchResp: SearchResponse = {
      data: [
        { id: 1, name: 'Consulting One Ltd', isActive: true, totalRecords: 3 },
        { id: 2, name: 'Consulting Two Ltd', isActive: false, totalRecords: 1 },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
    fake.search.mockResolvedValue(searchResp);

    const result = await searchSponsorsTool.handler(
      { query: 'consulting', country: 'uk', limit: 10 },
      { client },
    );

    expect(result.structuredContent?.total).toBe(2);
    expect(result.content[0]?.text).toContain('Consulting One Ltd');
    expect(result.content[0]?.text).toContain('Consulting Two Ltd');
    const results = result.structuredContent?.results as Array<{ id: number }>;
    expect(results).toHaveLength(2);
  });
});

describe('get_sponsor_details', () => {
  it('returns found:true for a UK organization', async () => {
    fake.getUkOrganization.mockResolvedValue(ukOrg);

    const result = await getSponsorDetailsTool.handler(
      { org_id: 1, country: 'uk', include_history: false },
      { client },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.found).toBe(true);
    expect(result.content[0]?.text).toContain('Acme Ltd');
  });

  it('returns a clean not-found result (not an error) when the org 404s', async () => {
    fake.getUkOrganization.mockRejectedValue(new NotFoundError());

    const result = await getSponsorDetailsTool.handler(
      { org_id: 999, country: 'uk', include_history: false },
      { client },
    );

    expect(result.structuredContent?.found).toBe(false);
    expect(result.isError).toBeFalsy();
  });
});

describe('get_register_info', () => {
  it('returns the glossary, stats, and the disclaimer', async () => {
    const result = await getRegisterInfoTool.handler({}, { client });

    expect(result.content[0]?.text).toContain('active sponsors');
    expect(result.content[0]?.text).toContain(DISCLAIMER);
    expect(result.structuredContent?.disclaimer).toBe(DISCLAIMER);
    const uk = result.structuredContent?.uk as { overview: string };
    expect(uk.overview).toContain('sponsorship licence');
  });
});
