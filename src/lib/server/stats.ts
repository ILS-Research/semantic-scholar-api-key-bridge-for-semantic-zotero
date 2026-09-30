/** Counters for the status page; no user data. */
export const stats = {
	startedAt: new Date().toISOString(),
	requests: 0,
	cacheHits: 0,
	upstreamRequests: 0,
	upstreamRetries: 0,
	rejectedAuth: 0,
	rejectedPath: 0,
	rejectedScope: 0,
	/** Refused with 429: too many waiting requests of one user. */
	overQueued: 0,
	busy: 0,
	errors: 0
};

export interface ClientStats {
	requests: number;
	/** Sent to Semantic Scholar, and their total time incl. waiting in the queue. */
	upstream: number;
	upstreamMs: number;
}

/** Per client: OIDC client ID or "zotero-group". */
export const clientStats = new Map<string, ClientStats>();

export function clientStat(client: string): ClientStats {
	let s = clientStats.get(client);
	if (!s) clientStats.set(client, (s = { requests: 0, upstream: 0, upstreamMs: 0 }));
	return s;
}
