import { describe, expect, it, vi } from 'vitest';

import type { SalaryCheckResponse } from '../src/api/schemas.js';
import type { SponsorFinderClient } from '../src/api/client.js';
import { checkSalaryThresholdTool } from '../src/tools/salary-check.js';

function response(over: Partial<SalaryCheckResponse> = {}): SalaryCheckResponse {
  return {
    route: 'skilled-worker',
    occupation: { socCode: '2134', title: 'Programmers and software development professionals' },
    candidates: [
      { socCode: '2134', title: 'Programmers and software development professionals', score: 0.86 },
    ],
    evaluation: {
      verdict: 'eligible',
      satisfiedByOption: 'A',
      countedWeeklyHours: 37.5,
      options: [
        {
          option: 'A',
          condition: 'Standard Skilled Worker application',
          qualifies: true,
          generalThresholdAnnual: 41_700,
          proRatedGoingRateAnnual: 54_700,
          requiredAnnual: 54_700,
          meets: true,
        },
      ],
    },
    goingRateAnnual: 54_700,
    effectiveFrom: '2026-08-21T00:00:00.000Z',
    sourceUrl: 'https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-occupations',
    disclaimer: 'not legal advice',
    ...over,
  };
}

function deps(result: SalaryCheckResponse) {
  const checkSalary = vi.fn().mockResolvedValue(result);
  return { client: { checkSalary } as unknown as SponsorFinderClient, checkSalary };
}

const baseArgs = { job_title: 'software developer', salary_gbp_per_year: 60_000, weekly_hours: 37.5 };

describe('check_salary_threshold', () => {
  it('sends a free-text title as title, not soc', async () => {
    const { client, checkSalary } = deps(response());
    await checkSalaryThresholdTool.handler(baseArgs, { client });
    expect(checkSalary).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'software developer' }),
    );
    expect(checkSalary.mock.calls[0]?.[0].soc).toBeUndefined();
  });

  it('routes a 4-digit input as a SOC code', async () => {
    const { client, checkSalary } = deps(response());
    await checkSalaryThresholdTool.handler({ ...baseArgs, job_title: '2134' }, { client });
    expect(checkSalary).toHaveBeenCalledWith(expect.objectContaining({ soc: '2134' }));
  });

  it('forwards asserted conditions and omits unasserted ones', async () => {
    const { client, checkSalary } = deps(response());
    await checkSalaryThresholdTool.handler(
      { ...baseArgs, new_entrant: true, phd_stem: false },
      { client },
    );
    const sent = checkSalary.mock.calls[0]?.[0];
    expect(sent.newEntrant).toBe(true);
    expect(sent.phdStem).toBeUndefined();
  });

  it('states the eligible verdict with the option that satisfied it', async () => {
    const { client } = deps(response());
    const r = await checkSalaryThresholdTool.handler(baseArgs, { client });
    expect(r.content[0]?.text).toContain('MEETS');
    expect(r.content[0]?.text).toContain('option A');
    expect(r.structuredContent?.verdict).toBe('eligible');
  });

  it('states the shortfall when not eligible', async () => {
    const { client } = deps(
      response({
        evaluation: {
          verdict: 'not_eligible',
          shortfallAnnual: 13_347,
          countedWeeklyHours: 40,
          options: [],
        },
      }),
    );
    const r = await checkSalaryThresholdTool.handler(baseArgs, { client });
    expect(r.content[0]?.text).toContain('BELOW');
    expect(r.content[0]?.text).toContain('£13,347');
  });

  it('passes the uncertain reason through verbatim — never a guessed number', async () => {
    const { client } = deps(
      response({
        evaluation: {
          verdict: 'uncertain',
          uncertainReason: 'This occupation is paid on national pay scales (option K).',
          countedWeeklyHours: 37.5,
          options: [],
        },
        goingRateAnnual: null,
      }),
    );
    const r = await checkSalaryThresholdTool.handler(baseArgs, { client });
    expect(r.content[0]?.text).toContain('UNCERTAIN');
    expect(r.content[0]?.text).toContain('national pay scales');
    expect(r.structuredContent?.verdict).toBe('uncertain');
  });

  it('lists near-miss candidates so an ambiguous title becomes a choice', async () => {
    const { client } = deps(
      response({
        candidates: [
          { socCode: '2134', title: 'Programmers and software development professionals', score: 0.86 },
          { socCode: '2132', title: 'IT managers', score: 0.48 },
        ],
      }),
    );
    const r = await checkSalaryThresholdTool.handler(baseArgs, { client });
    expect(r.content[0]?.text).toContain('IT managers (SOC 2132)');
  });

  it('every response carries the effective date, source and disclaimer', async () => {
    const { client } = deps(response());
    const r = await checkSalaryThresholdTool.handler(baseArgs, { client });
    expect(r.content[0]?.text).toContain('effective from 2026-08-21');
    expect(r.content[0]?.text).toContain('gov.uk');
    expect(r.structuredContent?.effective_from).toBe('2026-08-21T00:00:00.000Z');
    expect(r.structuredContent?.disclaimer).toBeTruthy();
  });
});
