import { z } from 'zod';

import type { SalaryCheckResponse } from '../api/schemas.js';
import { DISCLAIMER } from '../lib/glossary.js';
import { textResult, type ToolDefinition, type ToolResult } from './types.js';

/**
 * check_salary_threshold — three-state Skilled Worker salary verdict.
 *
 * Takes a JOB TITLE, not a SOC code: an assistant's user says "software
 * developer", never "SOC 2134" — the same reason check_sponsor_license takes
 * company_name rather than an id. The upstream resolves the title over the
 * appendix's own related-titles column and returns near-miss candidates, so an
 * ambiguous title degrades into a choice rather than a wrong answer.
 *
 * The response is self-contained on purpose: verdict, WHICH rule produced the
 * binding threshold, the shortfall, the rate's effective date and source, and
 * the disclaimer — because an MCP consumer restates answers as fact, stripped
 * of any surrounding page. `uncertain` is a first-class verdict, not an error.
 */

const inputSchema = {
  job_title: z
    .string()
    .min(2)
    .max(120)
    .describe(
      'The job title, e.g. "software developer" or "civil engineer". A 4-digit SOC 2020 code also works.',
    ),
  salary_gbp_per_year: z
    .number()
    .positive()
    .max(10_000_000)
    .describe('Gross annual salary of the offer, in pounds. Decimals allowed.'),
  weekly_hours: z
    .number()
    .positive()
    .max(100)
    .describe(
      'Contracted weekly hours. Required: going rates are published for a 37.5-hour week and pro-rate with actual hours, so the same salary can pass at 37.5 hours and fail at 45.',
    ),
  new_entrant: z
    .boolean()
    .optional()
    .describe('Applicant is a new entrant at the start of their career.'),
  phd_relevant: z
    .boolean()
    .optional()
    .describe('Applicant holds a PhD in a subject relevant to the job.'),
  phd_stem: z
    .boolean()
    .optional()
    .describe('Applicant holds a PhD in a STEM subject relevant to the job.'),
  on_immigration_salary_list: z
    .boolean()
    .optional()
    .describe(
      'The job is on the Immigration Salary List (asserted by the user — the list itself is not modelled).',
    ),
};

// Derived, not hand-written: exactOptionalPropertyTypes makes a manual copy
// of the shape drift from z.infer (boolean | undefined vs boolean).
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

const gbp = (n: number): string => `£${n.toLocaleString('en-GB')}`;

function verdictLine(r: SalaryCheckResponse, args: Args): string {
  const { evaluation: e, occupation } = r;
  const offer = `${gbp(args.salary_gbp_per_year)}/year at ${args.weekly_hours}h/week`;

  switch (e.verdict) {
    case 'eligible': {
      const opt = e.options.find((o) => o.option === e.satisfiedByOption);
      return (
        `MEETS the Skilled Worker salary requirement: ${offer} for ` +
        `${occupation.title} (SOC ${occupation.socCode})` +
        (opt
          ? ` — satisfied via option ${opt.option} (${opt.condition}), which requires ${gbp(opt.requiredAnnual ?? 0)}.`
          : '.')
      );
    }
    case 'not_eligible':
      return (
        `BELOW the Skilled Worker salary requirement: ${offer} for ` +
        `${occupation.title} (SOC ${occupation.socCode}) falls short by ` +
        `${gbp(e.shortfallAnnual ?? 0)}/year against the most favourable option the applicant qualifies for.`
      );
    default:
      return (
        `UNCERTAIN for ${occupation.title} (SOC ${occupation.socCode}): ` +
        (e.uncertainReason ?? 'the checker could not fully assess this occupation.')
      );
  }
}

export const checkSalaryThresholdTool: ToolDefinition<typeof inputSchema> = {
  name: 'check_salary_threshold',
  title: 'Skilled Worker Salary Check',
  description:
    'Check a UK job offer against the Skilled Worker visa salary thresholds and ' +
    'occupation going rates. Takes a job title (or SOC 2020 code), the annual salary, ' +
    'and the contracted weekly hours — hours matter, because going rates pro-rate. ' +
    'Returns a three-state verdict: eligible, not_eligible, or uncertain with the ' +
    'reason. Covers the standard Skilled Worker route only (not Health & Care or ' +
    'Global Business Mobility).',
  inputSchema,
  async handler(args: Args, { client }): Promise<ToolResult> {
    const isSoc = /^\d{4}$/.test(args.job_title.trim());
    const result = await client.checkSalary({
      ...(isSoc ? { soc: args.job_title.trim() } : { title: args.job_title.trim() }),
      salary: args.salary_gbp_per_year,
      weeklyHours: args.weekly_hours,
      ...(args.new_entrant ? { newEntrant: true } : {}),
      ...(args.phd_relevant ? { phdRelevant: true } : {}),
      ...(args.phd_stem ? { phdStem: true } : {}),
      ...(args.on_immigration_salary_list ? { immigrationSalaryList: true } : {}),
    });

    const lines = [verdictLine(result, args)];

    const others = result.candidates.filter(
      (c) => c.socCode !== result.occupation.socCode,
    );
    if (others.length > 0) {
      lines.push(
        `If a different occupation was meant: ${others
          .map((c) => `${c.title} (SOC ${c.socCode})`)
          .join('; ')}.`,
      );
    }
    if (result.effectiveFrom) {
      lines.push(
        `Going rate ${result.goingRateAnnual !== null ? gbp(result.goingRateAnnual) + '/year ' : ''}` +
          `effective from ${result.effectiveFrom.slice(0, 10)}. Source: ${result.sourceUrl}`,
      );
    }
    lines.push('', DISCLAIMER);

    return textResult(lines.join('\n'), {
      verdict: result.evaluation.verdict,
      route: result.route,
      occupation: result.occupation,
      candidates: result.candidates,
      evaluation: result.evaluation,
      going_rate_annual: result.goingRateAnnual,
      effective_from: result.effectiveFrom,
      source_url: result.sourceUrl,
      disclaimer: result.disclaimer,
    });
  },
};
