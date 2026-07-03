import type { z } from 'zod';

import type { RegisterStats } from '../api/schemas.js';
import { formatDate } from '../lib/format.js';
import { DISCLAIMER, NL_GLOSSARY, UK_GLOSSARY } from '../lib/glossary.js';
import { type ToolDefinition, type ToolResult, textResult } from './types.js';

// `get_register_info` takes no input.
const inputSchema = {};

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

function statsLine(label: string, stats: RegisterStats): string {
  return (
    `${label}: ${stats.totalActive.toLocaleString('en-US')} active sponsors ` +
    `(updated ${formatDate(stats.lastUpdated)}). ` +
    `Last 7 days: +${stats.newLast7Days} / -${stats.removedLast7Days} ` +
    `(reactivated ${stats.reactivatedLast7Days}). ` +
    `Last 30 days: +${stats.newLast30Days} / -${stats.removedLast30Days}.`
  );
}

export const getRegisterInfoTool: ToolDefinition<typeof inputSchema> = {
  name: 'get_register_info',
  title: 'About the Sponsor Registers',
  description:
    'Register statistics, data freshness, and terminology for the UK and Netherlands sponsor ' +
    'registers. Use this to explain what a licence, route, rating, or sponsor type means.',
  inputSchema,
  async handler(_args: Args, { client }): Promise<ToolResult> {
    const status = await client.getStatus();

    const text = [
      statsLine('UK (Home Office register of licensed sponsors)', status.uk),
      statsLine('Netherlands (IND register of recognised sponsors)', status.nl),
      '',
      UK_GLOSSARY.overview,
      NL_GLOSSARY.overview,
      '',
      DISCLAIMER,
    ].join('\n');

    return textResult(text, {
      uk: {
        stats: status.uk,
        overview: UK_GLOSSARY.overview,
        ratings: UK_GLOSSARY.ratings,
        routes: UK_GLOSSARY.routes,
      },
      nl: {
        stats: status.nl,
        overview: NL_GLOSSARY.overview,
        sponsorTypes: NL_GLOSSARY.sponsorTypes,
      },
      data_as_of: status.uk.lastUpdated,
      disclaimer: DISCLAIMER,
    });
  },
};
