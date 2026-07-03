import type { z } from 'zod';

import type { SponsorFinderClient } from '../api/client.js';

/** Dependencies injected into every tool handler (keeps handlers testable). */
export interface ToolDeps {
  client: SponsorFinderClient;
}

/** The subset of an MCP tool result the tools produce. */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * A tool definition. `inputSchema` is a Zod raw shape (the MCP SDK builds the
 * JSON Schema from it). The handler receives validated args plus deps and may
 * throw a `SponsorFinderError`; the registration wrapper converts throws into a
 * safe `isError` result and logs the call.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>, deps: ToolDeps) => Promise<ToolResult>;
}

/** Build a plain text result, omitting optional fields when absent. */
export function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError = false,
): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text }] };
  if (structuredContent !== undefined) result.structuredContent = structuredContent;
  if (isError) result.isError = true;
  return result;
}
