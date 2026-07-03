import { z } from 'zod';

import type { Country, OrganizationListItem } from '../api/schemas.js';
import { COUNTRY_LABEL, dataAsOfLine } from '../lib/format.js';
import { type ToolDefinition, type ToolResult, textResult } from './types.js';

const inputSchema = {
  query: z
    .string()
    .max(100)
    .optional()
    .describe('Substring to match in the company name'),
  country: z.enum(['uk', 'nl']).default('uk').describe('Which register to search'),
  city: z.string().max(100).optional().describe('Filter by city (UK only)'),
  route: z
    .string()
    .max(100)
    .optional()
    .describe('Filter by visa route, e.g. "Skilled Worker" (UK only)'),
  sponsor_type: z
    .enum(['WORK', 'EXCHANGE', 'STUDY', 'RESEARCH'])
    .optional()
    .describe('Filter by sponsor type (NL only)'),
  limit: z.number().int().min(1).max(20).default(10).describe('Max results (1–20)'),
};

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

function summariseItem(item: OrganizationListItem, country: Country): string {
  const status = item.isActive === false ? 'inactive' : 'active';
  if (country === 'uk') {
    return `  • ${item.name} (id ${item.id}, ${status}, ${item.totalRecords ?? 0} records)`;
  }
  return `  • ${item.name} (id ${item.id}, ${status}, type ${item.sponsorType ?? '—'})`;
}

export const searchSponsorsTool: ToolDefinition<typeof inputSchema> = {
  name: 'search_sponsors',
  title: 'Search Sponsor Register',
  description:
    'Exploratory list search of the sponsor register with optional filters (city/route for UK, ' +
    'sponsor type for NL). Returns a compact list with a total count. For checking one specific ' +
    'company, prefer check_sponsor_license.',
  inputSchema,
  async handler(args: Args, { client }): Promise<ToolResult> {
    const country = args.country;
    const [status, response] = await Promise.all([
      client.getStatus(),
      client.search({
        search: args.query,
        country,
        limit: args.limit,
        cities: country === 'uk' ? args.city : undefined,
        routes: country === 'uk' ? args.route : undefined,
        sponsorType: country === 'nl' ? args.sponsor_type : undefined,
      }),
    ]);

    const { data, meta } = response;
    const header =
      data.length === 0
        ? `No ${COUNTRY_LABEL[country]} sponsors matched.`
        : `${meta.total} ${COUNTRY_LABEL[country]} match${meta.total === 1 ? '' : 'es'}, showing ${data.length}:`;

    const body = data.map((item) => summariseItem(item, country)).join('\n');
    const text = [header, body, dataAsOfLine(status[country].lastUpdated, country)]
      .filter((line) => line.length > 0)
      .join('\n');

    return textResult(text, {
      country,
      total: meta.total,
      page: meta.page,
      limit: meta.limit,
      totalPages: meta.totalPages,
      results: data.map((item) => ({
        id: item.id,
        name: item.name,
        isActive: item.isActive ?? null,
        totalRecords: country === 'uk' ? (item.totalRecords ?? null) : null,
        sponsorType: country === 'nl' ? (item.sponsorType ?? null) : null,
      })),
      data_as_of: status[country].lastUpdated,
      source: dataAsOfLine(status[country].lastUpdated, country),
    });
  },
};
