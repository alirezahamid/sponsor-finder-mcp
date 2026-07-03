import { app } from './http-app.js';

/**
 * Cloudflare Workers entry. The same Hono app; Wrangler bundles this file from
 * source. `SPONSORFINDER_API_KEY` is provided as a Wrangler secret and reaches
 * the app via `c.env`.
 */
export default app;
