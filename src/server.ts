import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import { SponsorFinderClient } from './api/client.js';
import { loadConfig, type AppConfig } from './config.js';
import { createAnalytics, type Analytics } from './lib/analytics.js';
import { SponsorFinderError, toSafeMessage } from './lib/errors.js';
import { logToolCall } from './lib/logger.js';
import { checkLicenseTool } from './tools/check-license.js';
import { getRegisterInfoTool } from './tools/register-info.js';
import { getSponsorDetailsTool } from './tools/details.js';
import { searchSponsorsTool } from './tools/search.js';
import type { ToolDefinition, ToolDeps, ToolResult } from './tools/types.js';

export const SERVER_NAME = 'sponsor-finder-mcp';
export const SERVER_TITLE = 'SponsorFinder';
export const SERVER_VERSION = '1.0.0';
export const SERVER_WEBSITE = 'https://sponsorfinder.io';

/** Verdicts worth capturing a query name for (unmet-demand analysis). */
const CAPTURABLE_VERDICTS = new Set(['not_found', 'ambiguous']);

interface RegisterOptions {
  analytics: Analytics;
  captureQueryNames: boolean;
  /** Resolves the connected MCP client name (known only after `initialize`). */
  clientName: () => string | undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Register a tool with a wrapper that (a) enforces the `readOnlyHint` annotation
 * required by the MCP directory, (b) logs one structured line per call, (c) emits
 * a categorical GA4 analytics event, and (d) converts any thrown error into a
 * safe `isError` result that never leaks internals (spec §7).
 */
function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  deps: ToolDeps,
  def: ToolDefinition<Shape>,
  options: RegisterOptions,
): void {
  const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const start = Date.now();
    // `country` is a plain enum arg — safe (categorical) to record.
    const country = stringField(args, 'country');

    try {
      const result = await def.handler(args as z.infer<z.ZodObject<Shape>>, deps);
      const latencyMs = Date.now() - start;
      const ok = result.isError !== true;
      const verdict = stringField(result.structuredContent, 'verdict');

      // Query-name capture is OFF by default and never reaches GA — it only
      // enriches the server's own logs, for unmet-demand analysis.
      const query =
        options.captureQueryNames && verdict && CAPTURABLE_VERDICTS.has(verdict)
          ? stringField(args, 'company_name')
          : undefined;

      logToolCall({ tool: def.name, latencyMs, ok, verdict, query });
      options.analytics.track({
        tool: def.name,
        ok,
        latencyMs,
        country,
        verdict,
        mcpClient: options.clientName(),
      });
      return result as CallToolResult;
    } catch (error) {
      const latencyMs = Date.now() - start;
      const errorKind = error instanceof SponsorFinderError ? error.kind : 'unknown';

      logToolCall({ tool: def.name, latencyMs, ok: false, errorKind });
      options.analytics.track({
        tool: def.name,
        ok: false,
        latencyMs,
        country,
        errorKind,
        mcpClient: options.clientName(),
      });

      const errorResult: ToolResult = {
        content: [{ type: 'text', text: toSafeMessage(error) }],
        isError: true,
      };
      return errorResult as CallToolResult;
    }
  };

  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: { title: def.title, readOnlyHint: true },
    },
    // The generic wrapper prevents the SDK from inferring the exact arg type; the
    // handler is fully type-checked against its own inputSchema in each tool file.
    callback as never,
  );
}

/**
 * Cache one client (and therefore its TTL caches) per API base, so per-request
 * server construction on the HTTP transport does not discard cached `/status`
 * and `/filters` responses. Keyed by base URL — a process/isolate serves a
 * single upstream, so this stays a tiny map.
 */
const clientCache = new Map<string, SponsorFinderClient>();

function getClient(config: AppConfig): SponsorFinderClient {
  let client = clientCache.get(config.apiBase);
  if (!client) {
    client = new SponsorFinderClient(config);
    clientCache.set(config.apiBase, client);
  }
  return client;
}

/**
 * Build a fully-configured MCP server. Stateless per request: safe to construct
 * on every Cloudflare Workers / HTTP request or once for a stdio process. The
 * API client it wraps is memoised so caches survive across requests.
 *
 * @param env A plain environment record (`process.env` or Workers `c.env`).
 */
export function createServer(env: Record<string, string | undefined>): McpServer {
  const config = loadConfig(env);
  const deps: ToolDeps = { client: getClient(config) };

  const server = new McpServer({
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    websiteUrl: SERVER_WEBSITE,
    description:
      'Check whether a company holds a UK or Netherlands work-visa sponsorship licence.',
  });

  const options: RegisterOptions = {
    analytics: createAnalytics(config.analytics),
    captureQueryNames: config.captureQueryNames,
    clientName: () => server.server.getClientVersion()?.name,
  };

  registerTool(server, deps, checkLicenseTool, options);
  registerTool(server, deps, searchSponsorsTool, options);
  registerTool(server, deps, getSponsorDetailsTool, options);
  registerTool(server, deps, getRegisterInfoTool, options);

  return server;
}
