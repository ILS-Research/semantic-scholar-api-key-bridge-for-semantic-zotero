/**
 * Zotero group: a Zotero API key (header Zotero-API-Key) whose owner is a member of one of the
 * configured groups. The key is checked at the Zotero API (/keys/current) and the owner's groups
 * are listed with it (/users/{id}/groups). A key without library permissions is enough for
 * public groups; for private groups it needs read access to that group.
 *
 * The Zotero API blocks an address for a while after a few invalid keys. With a clientIp, it is sent
 * as Zotero-Forwarded-For, which a self-hosted dataserver honours from private addresses, so invalid
 * keys only block their sender, not the bridge. A block (429) is passed on as 429.
 */
import { AuthError, type AuthContext, type Identity } from './types';

export interface ZoteroOptions {
	apiUrl: string;
	groupIds: number[];
	fetch?: typeof fetch;
}

const HEADERS = { 'Zotero-API-Version': '3', accept: 'application/json' };

export function zoteroVerifier(o: ZoteroOptions): (key: string, ctx?: AuthContext) => Promise<Identity> {
	const doFetch = o.fetch ?? fetch;
	return async (key, ctx = {}) => {
		if (!/^[A-Za-z0-9]{10,64}$/.test(key)) throw new AuthError(401, 'invalid Zotero API key');
		const headers: Record<string, string> = { ...HEADERS, 'Zotero-API-Key': key };
		if (ctx.clientIp) headers['Zotero-Forwarded-For'] = ctx.clientIp;
		const get = async (path: string) => {
			const r = await doFetch(o.apiUrl + path, { headers, signal: AbortSignal.timeout(10_000) });
			if (r.status === 429) {
				const retry = Number(r.headers.get('retry-after')) || 300;
				throw new AuthError(429, 'too many invalid keys from your address; try again later', retry);
			}
			return r;
		};
		const k = await get('/keys/current');
		if (k.status === 403 || k.status === 404) throw new AuthError(401, 'invalid Zotero API key');
		if (!k.ok) throw new Error(`Zotero API /keys/current: HTTP ${k.status}`);
		const { userID } = await k.json();
		if (!Number.isInteger(userID)) throw new Error('Zotero API /keys/current: no userID');
		for (let start = 0; ; start += 100) {
			const g = await get(`/users/${userID}/groups?limit=100&start=${start}`);
			if (!g.ok) throw new Error(`Zotero API /users/${userID}/groups: HTTP ${g.status}`);
			const groups: any[] = await g.json();
			if (groups.some((x) => o.groupIds.includes(Number(x?.id)))) return { id: `zotero:${userID}`, method: 'zotero-group' };
			if (groups.length < 100) break;
		}
		throw new AuthError(403, 'not a member of the required Zotero group (a private group needs a key with read access to it)');
	};
}
