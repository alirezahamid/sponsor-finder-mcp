import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from '../server.js';

/**
 * stdio entry — for `npx`, Claude Desktop, Claude Code, and local development.
 * Protocol messages travel over stdout, so all logging goes to stderr.
 */

// Best-effort: load a local `.env` when run directly (`node dist/entry/stdio.js`).
// In hosted clients the environment is provided by the client config instead.
try {
  process.loadEnvFile?.();
} catch {
  // No .env file present — fall back to the real process environment.
}

const server = createServer(process.env);
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('sponsor-finder-mcp stdio transport ready');
