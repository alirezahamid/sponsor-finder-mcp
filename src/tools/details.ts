import { z } from 'zod';

import type { SponsorFinderClient } from '../api/client.js';
import type { Country, HistoryResponse, StatusResponse } from '../api/schemas.js';
import { NotFoundError } from '../lib/errors.js';
import { COUNTRY_LABEL, dataAsOfLine, formatDate, joinList } from '../lib/format.js';
import { type ToolDefinition, type ToolResult, textResult } from './types.js';

const HISTORY_LIMIT = 20;

const inputSchema = {
  org_id: z
    .number()
    .int()
    .positive()
    .describe('Organization id (from a search or check result)'),
  country: z
    .enum(['uk', 'nl'])
    .default('uk')
    .describe('Which register the id belongs to'),
  include_history: z
    .boolean()
    .default(false)
    .describe(
      'Also include register change history (ADDED / REMOVED / REACTIVATED events)',
    ),
};

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

function historyJson(history: HistoryResponse) {
  return {
    total: history.total,
    events: history.events.map((e) => ({
      eventType: e.eventType,
      timestamp: e.timestamp,
    })),
  };
}

function notFound(country: Country, orgId: number, status: StatusResponse): ToolResult {
  const text = [
    `❌ No ${COUNTRY_LABEL[country]} organization found with id ${orgId}.`,
    'The id may be wrong or from the other register — try check_sponsor_license by name.',
    dataAsOfLine(status[country].lastUpdated, country),
  ].join('\n');
  return textResult(text, {
    found: false,
    country,
    org_id: orgId,
    data_as_of: status[country].lastUpdated,
  });
}

async function renderUk(
  client: SponsorFinderClient,
  orgId: number,
  includeHistory: boolean,
  status: StatusResponse,
): Promise<ToolResult> {
  const org = await client.getUkOrganization(orgId);
  const history = includeHistory
    ? await client.getHistory(orgId, HISTORY_LIMIT)
    : undefined;

  const locations = org.cities.map((c) => c.displayName ?? c.name);
  const currentRecords = org.sponsorRecords.filter((r) => r.isInCurrentCsv).length;
  const historicalRecords = org.sponsorRecords.length - currentRecords;

  const lines = [
    `${org.name} — ${org.isActive ? 'active' : 'inactive'} on the UK sponsor register.`,
    `Routes: ${joinList(org.routes)}`,
    `Ratings: ${joinList(org.typeRatings)}`,
    `Locations: ${joinList(locations, ', ')}`,
    org.sector ? `Sector: ${org.sector}` : null,
    org.companiesHouseId ? `Companies House: ${org.companiesHouseId}` : null,
    `Records: ${currentRecords} current, ${historicalRecords} historical.`,
    `On register ${formatDate(org.firstSeenAt)} → ${formatDate(org.lastSeenAt)}.`,
    history ? `History: ${history.total} recorded event(s).` : null,
    dataAsOfLine(status.uk.lastUpdated, 'uk'),
  ].filter((line): line is string => line !== null);

  return textResult(lines.join('\n'), {
    found: true,
    country: 'uk',
    org: {
      id: org.id,
      name: org.name,
      isActive: org.isActive,
      routes: org.routes,
      typeRatings: org.typeRatings,
      cities: locations,
      counties: org.counties.map((c) => c.displayName ?? c.name),
      sector: org.sector ?? null,
      companiesHouseId: org.companiesHouseId ?? null,
      sicCodes: org.sicCodes,
      currentRecords,
      historicalRecords,
      totalRecords: org.totalRecords,
      firstSeenAt: org.firstSeenAt,
      lastSeenAt: org.lastSeenAt,
    },
    ...(history ? { history: historyJson(history) } : {}),
    data_as_of: status.uk.lastUpdated,
    source: dataAsOfLine(status.uk.lastUpdated, 'uk'),
  });
}

async function renderNl(
  client: SponsorFinderClient,
  orgId: number,
  includeHistory: boolean,
  status: StatusResponse,
): Promise<ToolResult> {
  const org = await client.getNlOrganization(orgId);
  const history = includeHistory
    ? await client.getHistory(orgId, HISTORY_LIMIT)
    : undefined;

  const lines = [
    `${org.name} — recognised sponsor in the Netherlands (type: ${org.sponsorType}).`,
    org.kvkNumber ? `KvK number: ${org.kvkNumber}.` : null,
    `On register ${formatDate(org.firstSeenAt)} → ${formatDate(org.lastSeenAt)}.`,
    'The Dutch register carries no routes, ratings, or locations.',
    history ? `History: ${history.total} recorded event(s).` : null,
    dataAsOfLine(status.nl.lastUpdated, 'nl'),
  ].filter((line): line is string => line !== null);

  return textResult(lines.join('\n'), {
    found: true,
    country: 'nl',
    org: {
      id: org.id,
      name: org.name,
      isActive: org.isActive ?? true,
      sponsorType: org.sponsorType,
      kvkNumber: org.kvkNumber ?? null,
      firstSeenAt: org.firstSeenAt,
      lastSeenAt: org.lastSeenAt,
    },
    ...(history ? { history: historyJson(history) } : {}),
    data_as_of: status.nl.lastUpdated,
    source: dataAsOfLine(status.nl.lastUpdated, 'nl'),
  });
}

export const getSponsorDetailsTool: ToolDefinition<typeof inputSchema> = {
  name: 'get_sponsor_details',
  title: 'Get Sponsor Details',
  description:
    'Full record for one organization by id: routes, ratings, locations and register dates (UK), ' +
    'or sponsor type and KvK number (NL). Optionally include register change history.',
  inputSchema,
  async handler(args: Args, { client }): Promise<ToolResult> {
    const status = await client.getStatus();
    try {
      return args.country === 'uk'
        ? await renderUk(client, args.org_id, args.include_history, status)
        : await renderNl(client, args.org_id, args.include_history, status);
    } catch (error) {
      // 404 is a normal outcome, not a failure — return clean text (spec §4.3).
      if (error instanceof NotFoundError) {
        return notFound(args.country, args.org_id, status);
      }
      throw error;
    }
  },
};
