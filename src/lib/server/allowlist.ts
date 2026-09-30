/**
 * The Semantic Scholar endpoints the bridge forwards, in access levels (scopes):
 *   papers          read-only paper lookups and recommendations (every client)
 *   papers+authors  additionally author lookups (e.g. MCP servers; per OIDC client, OIDC_CLIENT_SCOPES)
 * Everything else (datasets, snippet search, releases, …) is refused, so the shared key cannot be
 * used for bulk downloads through the bridge.
 */
export type Scope = 'papers' | 'papers+authors';
export const SCOPES: Scope[] = ['papers', 'papers+authors'];

type Patterns = { GET: RegExp[]; POST: RegExp[] };

const PAPERS: Patterns = {
	// paper by any ID (DOIs and URL: IDs contain slashes), its references, citations, authors;
	// search, search/match, search/bulk, autocomplete
	GET: [/^\/graph\/v1\/paper\/.+$/, /^\/recommendations\/v1\/papers\/forpaper\/.+$/],
	POST: [/^\/graph\/v1\/paper\/batch$/, /^\/recommendations\/v1\/papers\/?$/]
};

const AUTHORS: Patterns = {
	// author by ID, their papers; author search
	GET: [/^\/graph\/v1\/author\/.+$/],
	POST: [/^\/graph\/v1\/author\/batch$/]
};

const LEVELS: Record<Scope, Patterns[]> = { papers: [PAPERS], 'papers+authors': [PAPERS, AUTHORS] };

/** Whether `scope` allows the request; without a scope: whether any scope does (checked before authentication). */
export function isAllowed(method: string, path: string, scope: Scope = 'papers+authors'): boolean {
	if (path.includes('..') || (method !== 'GET' && method !== 'POST')) return false;
	return LEVELS[scope].some((p) => p[method as 'GET' | 'POST'].some((r) => r.test(path)));
}
