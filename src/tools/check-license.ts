import { z } from 'zod';

import type { SponsorFinderClient } from '../api/client.js';
import type {
  Country,
  NlOrganization,
  StatusResponse,
  UkOrganization,
} from '../api/schemas.js';
import { NotFoundError } from '../lib/errors.js';
import {
  COUNTRY_LABEL,
  dataAsOfLine,
  formatDate,
  joinList,
  scoreText,
} from '../lib/format.js';
import {
  classify,
  type Candidate,
  type Classification,
  type Verdict,
} from '../lib/verdict.js';
import { type ToolDefinition, type ToolResult, textResult } from './types.js';

const FUZZY_LIMIT = 5;

const inputSchema = {
  company_name: z
    .string()
    .min(2)
    .max(100)
    .describe('Company name, exact or approximate (typos OK)'),
  country: z
    .enum(['uk', 'nl', 'both'])
    .default('both')
    .describe('Which register to check: uk, nl, or both'),
};

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

/** Rank verdicts so `both` can pick the most informative country result. */
const VERDICT_RANK: Record<Verdict, number> = {
  licensed: 3,
  formerly_licensed: 2,
  ambiguous: 1,
  not_found: 0,
};

interface CountryResult {
  country: Country;
  classification: Classification;
}

async function classifyCountry(
  client: SponsorFinderClient,
  companyName: string,
  country: Country,
): Promise<CountryResult> {
  const response = await client.fuzzy({ q: companyName, country, limit: FUZZY_LIMIT });
  return { country, classification: classify(companyName, response.data) };
}

/** Pick the best country result: highest verdict rank, then highest top score. */
function pickBest(results: CountryResult[]): CountryResult {
  return results.reduce((best, current) => {
    const bestRank = VERDICT_RANK[best.classification.verdict];
    const currentRank = VERDICT_RANK[current.classification.verdict];
    if (currentRank !== bestRank) return currentRank > bestRank ? current : best;
    const bestScore = best.classification.candidates[0]?.score ?? 0;
    const currentScore = current.classification.candidates[0]?.score ?? 0;
    return currentScore > bestScore ? current : best;
  });
}

function candidateJson(candidate: Candidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    score: Number(candidate.score.toFixed(4)),
    isActive: candidate.isActive,
  };
}

/**
 * Render a confident match from fuzzy data alone. Used when the follow-up detail
 * fetch 404s (a race), so we still give an honest answer without the extras.
 */
function renderMatchFromFuzzy(
  country: Country,
  classification: Classification,
  status: StatusResponse,
): ToolResult {
  const match = classification.match!;
  const licensed = classification.verdict === 'licensed';
  const asOf = dataAsOfLine(status[country].lastUpdated, country);
  const confidence = `Match confidence: ${scoreText(match.score)} (query: "${classification.query}").`;

  const verb =
    country === 'uk'
      ? licensed
        ? 'holds an active UK sponsorship licence'
        : 'is not currently on the UK sponsor register (formerly licensed)'
      : licensed
        ? 'is a recognised sponsor in the Netherlands'
        : 'is no longer a recognised sponsor in the Netherlands';

  const text = [
    `${licensed ? '✅' : '⚠️'} ${match.name} ${verb}.`,
    confidence,
    asOf,
  ].join('\n');

  return textResult(text, {
    verdict: classification.verdict,
    country,
    query: classification.query,
    match: {
      id: match.id,
      name: match.name,
      isActive: match.isActive,
      score: candidateJson(match).score,
    },
    candidates: classification.candidates.map(candidateJson),
    data_as_of: status[country].lastUpdated,
    source: dataAsOfLine(status[country].lastUpdated, country),
  });
}

async function renderMatch(
  client: SponsorFinderClient,
  country: Country,
  classification: Classification,
  status: StatusResponse,
): Promise<ToolResult> {
  const match = classification.match!;
  const asOf = dataAsOfLine(status[country].lastUpdated, country);
  const confidence = `Match confidence: ${scoreText(match.score)} (query: "${classification.query}").`;
  const licensed = classification.verdict === 'licensed';

  if (country === 'uk') {
    let org: UkOrganization;
    try {
      org = await client.getUkOrganization(match.id);
    } catch (error) {
      // The record can vanish between the fuzzy hit and the detail fetch; fall
      // back to what the fuzzy result already told us rather than erroring out.
      if (error instanceof NotFoundError) {
        return renderMatchFromFuzzy(country, classification, status);
      }
      throw error;
    }
    const locations = org.cities.map((c) => c.displayName ?? c.name);
    const currentRecords = org.sponsorRecords.filter((r) => r.isInCurrentCsv).length;

    const lines = licensed
      ? [
          `✅ ${org.name} holds an active UK sponsorship licence.`,
          `Routes: ${joinList(org.routes)}`,
          `Rating: ${joinList(org.typeRatings)}  |  Locations: ${joinList(locations, ', ')}`,
          `On register since ${formatDate(org.firstSeenAt)}. ${confidence}`,
          asOf,
        ]
      : [
          `⚠️ ${org.name} is NOT currently on the UK sponsor register (formerly licensed).`,
          `It was last seen on the register on ${formatDate(org.lastSeenAt)}.`,
          `Previous routes: ${joinList(org.routes)}. ${confidence}`,
          asOf,
        ];

    return textResult(lines.join('\n'), {
      verdict: classification.verdict,
      country,
      query: classification.query,
      match: {
        id: org.id,
        name: org.name,
        isActive: org.isActive,
        score: candidateJson(match).score,
        routes: org.routes,
        typeRatings: org.typeRatings,
        locations,
        sector: org.sector ?? null,
        companiesHouseId: org.companiesHouseId ?? null,
        firstSeenAt: org.firstSeenAt,
        lastSeenAt: org.lastSeenAt,
        currentRecords,
        totalRecords: org.totalRecords,
      },
      candidates: classification.candidates.map(candidateJson),
      data_as_of: status[country].lastUpdated,
      source: dataAsOfLine(status[country].lastUpdated, country),
    });
  }

  // Netherlands
  let org: NlOrganization;
  try {
    org = await client.getNlOrganization(match.id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return renderMatchFromFuzzy(country, classification, status);
    }
    throw error;
  }
  const lines = licensed
    ? [
        `✅ ${org.name} is a recognised sponsor in the Netherlands (type: ${org.sponsorType}).`,
        org.kvkNumber ? `KvK number: ${org.kvkNumber}.` : null,
        `On register since ${formatDate(org.firstSeenAt)}. ${confidence}`,
        'Note: the Dutch register lists recognised sponsors only — no routes, ratings, or locations.',
        asOf,
      ]
    : [
        `⚠️ ${org.name} is no longer a recognised sponsor in the Netherlands.`,
        `Last seen on the register on ${formatDate(org.lastSeenAt)}. ${confidence}`,
        asOf,
      ];

  return textResult(lines.filter((l): l is string => l !== null).join('\n'), {
    verdict: classification.verdict,
    country,
    query: classification.query,
    match: {
      id: org.id,
      name: org.name,
      // NL detail's isActive can lag the register; the verdict was driven by the
      // fuzzy hit's isActive, so report that to stay consistent with the text.
      isActive: match.isActive,
      score: candidateJson(match).score,
      sponsorType: org.sponsorType,
      kvkNumber: org.kvkNumber ?? null,
      firstSeenAt: org.firstSeenAt,
      lastSeenAt: org.lastSeenAt,
    },
    candidates: classification.candidates.map(candidateJson),
    data_as_of: status[country].lastUpdated,
    source: dataAsOfLine(status[country].lastUpdated, country),
  });
}

function renderAmbiguous(
  country: Country,
  classification: Classification,
  status: StatusResponse,
): ToolResult {
  const top = classification.candidates.slice(0, FUZZY_LIMIT);
  const list = top
    .map(
      (c) =>
        `  • ${c.name} (id ${c.id}, score ${scoreText(c.score)}, ${c.isActive ? 'active' : 'inactive'})`,
    )
    .join('\n');
  const text = [
    `❓ Multiple ${COUNTRY_LABEL[country]} sponsors could match "${classification.query}". I won't guess.`,
    'Candidates:',
    list,
    'Ask the user which one they mean, or call get_sponsor_details with the right id.',
    dataAsOfLine(status[country].lastUpdated, country),
  ].join('\n');

  return textResult(text, {
    verdict: 'ambiguous',
    country,
    query: classification.query,
    candidates: top.map(candidateJson),
    data_as_of: status[country].lastUpdated,
    source: dataAsOfLine(status[country].lastUpdated, country),
  });
}

function renderNotFound(
  country: Country,
  classification: Classification,
  status: StatusResponse,
): ToolResult {
  const suggestions = classification.candidates.slice(0, 3);
  const suggestionText =
    suggestions.length > 0
      ? `\nClosest names on the register: ${suggestions.map((c) => c.name).join('; ')}. Check spelling?`
      : '\nDouble-check the spelling, or try the full registered company name.';

  const text = [
    `❌ No ${COUNTRY_LABEL[country]} sponsor found matching "${classification.query}".`,
    `Absence from the register means the company cannot currently sponsor that visa type.${suggestionText}`,
    dataAsOfLine(status[country].lastUpdated, country),
  ].join('\n');

  return textResult(text, {
    verdict: 'not_found',
    country,
    query: classification.query,
    candidates: suggestions.map(candidateJson),
    data_as_of: status[country].lastUpdated,
    source: dataAsOfLine(status[country].lastUpdated, country),
  });
}

async function render(
  client: SponsorFinderClient,
  best: CountryResult,
  status: StatusResponse,
): Promise<ToolResult> {
  const { country, classification } = best;
  switch (classification.verdict) {
    case 'licensed':
    case 'formerly_licensed':
      return renderMatch(client, country, classification, status);
    case 'ambiguous':
      return renderAmbiguous(country, classification, status);
    case 'not_found':
      return renderNotFound(country, classification, status);
  }
}

export const checkLicenseTool: ToolDefinition<typeof inputSchema> = {
  name: 'check_sponsor_license',
  title: 'Check Sponsorship Licence',
  description:
    'Check whether a company holds a UK or Netherlands work-visa sponsorship licence. ' +
    'Handles typos and partial names. Returns licence routes, ratings, locations and register ' +
    'dates. For exploring or filtering many companies, use search_sponsors instead.',
  inputSchema,
  async handler(args: Args, { client }): Promise<ToolResult> {
    const countries: Country[] = args.country === 'both' ? ['uk', 'nl'] : [args.country];

    const [status, results] = await Promise.all([
      client.getStatus(),
      Promise.all(countries.map((c) => classifyCountry(client, args.company_name, c))),
    ]);

    const best = pickBest(results);
    return render(client, best, status);
  },
};
