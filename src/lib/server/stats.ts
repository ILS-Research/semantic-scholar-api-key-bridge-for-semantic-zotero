/** Counters for the status page; no user data. */
export const stats = {
	startedAt: new Date().toISOString(),
	requests: 0,
	cacheHits: 0,
	upstreamRequests: 0,
	upstreamRetries: 0,
	rejectedAuth: 0,
	rejectedPath: 0,
	busy: 0,
	errors: 0
};
