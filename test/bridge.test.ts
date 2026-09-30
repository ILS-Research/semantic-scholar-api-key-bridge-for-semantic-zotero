import { describe, expect, it } from 'vitest';
import { Bridge } from '../src/lib/server/bridge';
import { AuthError } from '../src/lib/server/auth/types';
import { parseConfig } from '../src/lib/server/config';

function setup(answer: (url: string, init: any) => Response, env: Record<string, string> = {}) {
	const upstream: { url: string; init: any }[] = [];
	const cfg = parseConfig({ AUTH: 'zotero-group', ZOTERO_GROUP_IDS: '1', S2_API_KEY: 'SECRET', S2_BASE_URL: 'https://s2', RATE_PER_SEC: '100', ...env });
	const bridge = new Bridge(cfg, {
		fetch: (async (url: string, init: any) => { upstream.push({ url, init }); return answer(url, init); }) as any,
		verifiers: { 'zotero-group': async (k) => { if (k !== 'member') throw new AuthError(403, 'not a member'); return { id: 'zotero:1', method: 'zotero-group' }; } }
	});
	const call = (path: string, init: RequestInit & { key?: string } = {}) =>
		bridge.handle(new Request(`http://bridge${path}`, { ...init, headers: { ...(init.key === undefined ? { 'zotero-api-key': 'member' } : init.key ? { 'zotero-api-key': init.key } : {}), ...(init.headers as any) } }));
	return { bridge, upstream, call };
}

describe('Bridge: client scopes and queue cap', () => {
	function oidcSetup(env: Record<string, string> = {}, answer = () => Response.json({})) {
		const upstream: string[] = [];
		const cfg = parseConfig({ AUTH: 'oidc,zotero-group', OIDC_ISSUER: 'https://kc', OIDC_AUDIENCE: 'semantic-zotero,openwebui',
			OIDC_CLIENT_SCOPES: 'openwebui:papers+authors', ZOTERO_GROUP_IDS: '1', S2_BASE_URL: 'https://s2', RATE_PER_SEC: '100', ...env });
		const bridge = new Bridge(cfg, {
			fetch: (async (url: string) => { upstream.push(url); return answer(); }) as any,
			verifiers: {
				oidc: async (t) => ({ id: `oidc:${t}`, method: 'oidc', client: t.startsWith('owui') ? 'openwebui' : 'semantic-zotero' }),
				'zotero-group': async () => ({ id: 'zotero:1', method: 'zotero-group' })
			}
		});
		const as = (path: string, h: Record<string, string>) => bridge.handle(new Request(`http://bridge${path}`, { headers: h }));
		return { upstream, as };
	}
	it('authors only for clients with papers+authors; 403 for others, 404 for unknown paths', async () => {
		const { upstream, as } = oidcSetup();
		expect((await as('/graph/v1/author/1', { authorization: 'Bearer owui-1' })).status).toBe(200);
		expect((await as('/graph/v1/author/1', { authorization: 'Bearer zot-1' })).status).toBe(403);
		expect((await as('/graph/v1/author/1', { 'zotero-api-key': 'k' })).status).toBe(403);
		expect((await as('/graph/v1/paper/x', { 'zotero-api-key': 'k' })).status).toBe(200);
		expect((await as('/graph/v1/author/1', {})).status).toBe(401);
		expect((await as('/datasets/v1/release', { authorization: 'Bearer owui-1' })).status).toBe(404);
		expect(upstream).toEqual(['https://s2/graph/v1/author/1', 'https://s2/graph/v1/paper/x']);
	});
	it('429 with Retry-After when a user has too many waiting requests; others unaffected', async () => {
		const { as } = oidcSetup({ MAX_QUEUED_PER_USER: '2', RATE_PER_SEC: '10' });
		const agent = { authorization: 'Bearer owui-agent' };
		// first request starts at once; the next two wait in the queue (100 ms apart), the fourth is refused
		const pending = ['a', 'b', 'c'].map((p) => as(`/graph/v1/paper/${p}`, agent));
		await new Promise((r) => setTimeout(r, 20));
		const over = await as('/graph/v1/paper/d', agent);
		expect(over.status).toBe(429);
		expect(Number(over.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
		const other = as('/graph/v1/paper/e', { authorization: 'Bearer zot-2' });
		expect([...(await Promise.all(pending)), await other].map((r) => r.status)).toEqual([200, 200, 200, 200]);
	});
});

describe('Bridge', () => {
	it('forwards with the shared key, not the user credential; caches 200', async () => {
		const { upstream, call } = setup(() => Response.json({ data: [] }));
		const r1 = await call('/graph/v1/paper/DOI:10.1/x/references?fields=title');
		expect(r1.status).toBe(200);
		expect(r1.headers.get('x-bridge-cache')).toBe('miss');
		expect(upstream[0].url).toBe('https://s2/graph/v1/paper/DOI:10.1/x/references?fields=title');
		expect(upstream[0].init.headers['x-api-key']).toBe('SECRET');
		expect(JSON.stringify(upstream[0].init.headers)).not.toContain('member');
		const r2 = await call('/graph/v1/paper/DOI:10.1/x/references?fields=title');
		expect(r2.headers.get('x-bridge-cache')).toBe('hit');
		expect(await r2.json()).toEqual({ data: [] });
		expect(upstream.length).toBe(1);
	});
	it('refuses unknown paths and missing or wrong credentials without calling upstream', async () => {
		const { upstream, call } = setup(() => Response.json({}));
		expect((await call('/graph/v1/datasets/x')).status).toBe(404);
		expect((await call('/datasets/v1/release/latest')).status).toBe(404);
		expect((await call('/graph/v1/paper/x', { key: '' })).status).toBe(401);
		const r = await call('/graph/v1/paper/x', { key: 'stranger' });
		expect(r.status).toBe(403);
		expect((await r.json()).message).toBe('not a member');
		expect(upstream.length).toBe(0);
	});
	it('503 with Retry-After when Semantic Scholar stays at 429', async () => {
		const { call } = setup(() => new Response('', { status: 429, headers: { 'retry-after': '7' } }), { RETRY_BUDGET_SEC: '1' });
		const r = await call('/graph/v1/paper/x');
		expect(r.status).toBe(503);
		expect(r.headers.get('retry-after')).toBe('7');
	});
	it('POST batch: body forwarded, cached by body', async () => {
		const { upstream, call } = setup((_u, init) => Response.json(JSON.parse(new TextDecoder().decode(init.body)).ids));
		const post = (ids: string[]) => call('/graph/v1/paper/batch?fields=title', { method: 'POST', body: JSON.stringify({ ids }), headers: { 'content-type': 'application/json' } });
		expect(await (await post(['a'])).json()).toEqual(['a']);
		expect(await (await post(['b'])).json()).toEqual(['b']);
		expect((await post(['a'])).headers.get('x-bridge-cache')).toBe('hit');
		expect(upstream.length).toBe(2);
		expect(upstream[0].init.headers['content-type']).toBe('application/json');
	});
	it('does not cache errors other than 404', async () => {
		let n = 0;
		const { call } = setup(() => new Response('{}', { status: n++ ? 200 : 500 }));
		expect((await call('/graph/v1/paper/x')).status).toBe(500);
		expect((await call('/graph/v1/paper/x')).status).toBe(200);
	});
	it('upstream unreachable: 502', async () => {
		const { call } = setup(() => { throw new Error('ECONNREFUSED'); });
		expect((await call('/graph/v1/paper/x')).status).toBe(502);
	});
});
