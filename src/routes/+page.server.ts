import { bridge } from '$lib/server/bridge';
import { config } from '$lib/server/config';
import { clientStats, stats } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const cfg = config();
	if (!cfg.statusPage) return { enabled: false as const };
	const b = bridge(cfg);
	return {
		enabled: true as const,
		auth: cfg.auth,
		ratePerSec: cfg.ratePerSec,
		stats: { ...stats },
		clients: [...clientStats].map(([name, c]) => ({
			name,
			requests: c.requests,
			upstream: c.upstream,
			avgMs: c.upstream ? Math.round(c.upstreamMs / c.upstream) : 0
		})),
		cache: b.cache.size,
		waiting: b.queue.waiting
	};
};
