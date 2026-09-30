// Forwarded to Semantic Scholar after authentication (see lib/server/bridge.ts)
import { bridge } from '$lib/server/bridge';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

export const fallback: RequestHandler = ({ request }) => bridge(config()).handle(request);
