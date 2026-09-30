import { bridge } from '$lib/server/bridge';
import { config } from '$lib/server/config';
import { clientStats, stats } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

// Plain server-rendered page without scripts: works behind a path prefix (e.g. /s2/) without base-path config
export const csr = false;

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
