import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import { SponsorFinderClient } from './api/client.js';
import { loadConfig, type AppConfig } from './config.js';
import { SponsorFinderError, toSafeMessage } from './lib/errors.js';
import { logToolCall } from './lib/logger.js';
import { checkLicenseTool } from './tools/check-license.js';
import { getRegisterInfoTool } from './tools/register-info.js';
import { getSponsorDetailsTool } from './tools/details.js';
import { searchSponsorsTool } from './tools/search.js';
import type { ToolDefinition, ToolDeps, ToolResult } from './tools/types.js';

export const SERVER_NAME = 'sponsor-finder-mcp';
export const SERVER_VERSION = '1.0.0';

/**
 * Register a tool with a wrapper that (a) enforces the `readOnlyHint` annotation
 * required by the MCP directory, (b) logs one structured line per call, and
 * (c) converts any thrown error into a safe `isError` result that never leaks
 * internals (spec §7).
 */
function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  deps: ToolDeps,
  def: ToolDefinition<Shape>,
): void {
  const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const start = Date.now();
    try {
      const result = await def.handler(args as z.infer<z.ZodObject<Shape>>, deps);
      logToolCall({
        tool: def.name,
        latencyMs: Date.now() - start,
        ok: result.isError !== true,
        verdict:
          typeof result.structuredContent?.verdict === 'string'
            ? result.structuredContent.verdict
            : undefined,
      });
      return result as CallToolResult;
    } catch (error) {
      logToolCall({
        tool: def.name,
        latencyMs: Date.now() - start,
        ok: false,
        errorKind: error instanceof SponsorFinderError ? error.kind : 'unknown',
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

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTool(server, deps, checkLicenseTool);
  registerTool(server, deps, searchSponsorsTool);
  registerTool(server, deps, getSponsorDetailsTool);
  registerTool(server, deps, getRegisterInfoTool);

  return server;
}
