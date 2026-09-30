/**
 * The Semantic Scholar endpoints the bridge forwards: read-only paper lookups. Everything else
 * (authors, datasets, snippet search, …) is refused, so the shared key cannot be used for bulk
 * downloads through the bridge.
 */
const GET_PATTERNS: RegExp[] = [
	// paper by any ID (DOIs and URL: IDs contain slashes), its references, citations, authors;
	// search, search/match, search/bulk, autocomplete
	/^\/graph\/v1\/paper\/.+$/,
	/^\/recommendations\/v1\/papers\/forpaper\/.+$/
];

const POST_PATTERNS: RegExp[] = [/^\/graph\/v1\/paper\/batch$/, /^\/recommendations\/v1\/papers\/?$/];

export function isAllowed(method: string, path: string): boolean {
	if (path.includes('..')) return false;
	if (method === 'GET') return GET_PATTERNS.some((p) => p.test(path));
	if (method === 'POST') return POST_PATTERNS.some((p) => p.test(path));
	return false;
}
