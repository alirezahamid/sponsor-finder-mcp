import { serve } from '@hono/node-server';

import { app } from './http-app.js';

/**
 * Node entry (VPS Docker container). Serves the shared Hono app over HTTP.
 * Config is read from `process.env` inside the app.
 */
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  // Log to stderr; stdout is reserved for the stdio transport elsewhere.
  console.error(`sponsor-finder-mcp listening on http://localhost:${info.port}/mcp`);
});
