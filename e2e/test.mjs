// E2E tests against the production image (see docker-compose.yml), Node's test runner.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

const BRIDGE = process.env.BRIDGE ?? 'http://bridge:8080';
const S2 = 'http://mocks:9001';
const OIDC = 'http://mocks:9002';
const ZOTERO = 'http://mocks:9003';
const MEMBER = 'memberkey0123456789';

const token = async (claims) =>
	(await (await fetch(`${OIDC}/__token`, { method: 'POST', body: JSON.stringify(claims) })).json()).access_token;
const good = () => token({ aud: 'account', azp: 'semantic-zotero', realm_access: { roles: ['s2-users'] } });
const s2Requests = async () => (await fetch(`${S2}/__requests`)).json();
const reset = () => fetch(`${S2}/__reset`, { method: 'POST' });
const get = (path, headers = {}) => fetch(BRIDGE + path, { headers });

before(async () => {
	for (let i = 0; i < 60; i++) {
		try { if ((await fetch(`${BRIDGE}/healthz`)).ok) return; } catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error('bridge not ready');
});

test('health and status page', async () => {
	assert.equal(await (await get('/healthz')).text(), 'ok');
	const page = await (await get('/')).text();
	assert.match(page, /Semantic Scholar Bridge/);
	assert.match(page, /oidc, zotero-group/);
});

test('no credentials: 401 with a hint; unknown endpoint: 404', async () => {
	const r = await get('/graph/v1/paper/X');
	assert.equal(r.status, 401);
	assert.match((await r.json()).message, /Bearer .*Zotero-API-Key/);
	assert.equal((await get('/datasets/v1/release/latest', { 'zotero-api-key': MEMBER })).status, 404);
});

test('OIDC: valid token forwarded with the shared key only', async () => {
	await reset();
	const t = await good();
	const r = await get('/graph/v1/paper/DOI:10.1000/xyz/references?fields=title', { authorization: `Bearer ${t}` });
	assert.equal(r.status, 200);
	assert.equal((await r.json()).paperId, 'DOI:10.1000/xyz');
	const [seen] = await s2Requests();
	assert.equal(seen.path, '/graph/v1/paper/DOI:10.1000/xyz/references');
	assert.equal(seen.query, '?fields=title');
	assert.equal(seen.headers['x-api-key'], 'bridge-key');
	assert.equal(seen.headers.authorization, undefined);
});

test('OIDC: missing role 403, wrong audience / expired / garbage 401', async () => {
	assert.equal((await get('/graph/v1/paper/A', { authorization: `Bearer ${await token({ aud: 'semantic-zotero' })}` })).status, 403);
	assert.equal((await get('/graph/v1/paper/A', { authorization: `Bearer ${await token({ aud: 'other', realm_access: { roles: ['s2-users'] } })}` })).status, 401);
	const expired = await token({ aud: 'semantic-zotero', realm_access: { roles: ['s2-users'] }, exp: Math.floor(Date.now() / 1000) - 60 });
	assert.equal((await get('/graph/v1/paper/A', { authorization: `Bearer ${expired}` })).status, 401);
	assert.equal((await get('/graph/v1/paper/A', { authorization: 'Bearer garbage' })).status, 401);
});

test('Zotero group: member 200, other group 403, invalid key 401; results remembered', async () => {
	await reset();
	const calls0 = (await (await fetch(`${ZOTERO}/__calls`)).json()).calls;
	assert.equal((await get('/graph/v1/paper/Z1', { 'zotero-api-key': MEMBER })).status, 200);
	assert.equal((await get('/graph/v1/paper/Z2', { 'zotero-api-key': MEMBER })).status, 200);
	const calls1 = (await (await fetch(`${ZOTERO}/__calls`)).json()).calls;
	assert.equal(calls1 - calls0, 2, 'key and groups checked once, then remembered');
	assert.equal((await get('/graph/v1/paper/Z1', { 'zotero-api-key': 'otherkey0123456789' })).status, 403);
	assert.equal((await get('/graph/v1/paper/Z1', { 'zotero-api-key': 'wrongkey0123456789' })).status, 401);
	const seen = await s2Requests();
	assert.equal(seen.length, 2);
	assert.ok(seen.every((s) => s.headers['zotero-api-key'] === undefined), 'Zotero key must not reach Semantic Scholar');
});

test('cache: same request answered by the bridge', async () => {
	await reset();
	const h = { 'zotero-api-key': MEMBER };
	assert.equal((await get('/graph/v1/paper/C1?fields=title', h)).headers.get('x-bridge-cache'), 'miss');
	assert.equal((await get('/graph/v1/paper/C1?fields=title', h)).headers.get('x-bridge-cache'), 'hit');
	assert.equal((await get('/graph/v1/paper/C1?fields=year', h)).headers.get('x-bridge-cache'), 'miss');
	assert.equal((await s2Requests()).length, 2);
});

test('429: retried, then 200; persistent 429: 503 with Retry-After', async () => {
	await reset();
	const h = { 'zotero-api-key': MEMBER };
	const r = await get('/graph/v1/paper/RATE429', h);
	assert.equal(r.status, 200);
	assert.equal((await s2Requests()).length, 3);
	const busy = await get('/graph/v1/paper/ALWAYS429', h);
	assert.equal(busy.status, 503);
	assert.equal(busy.headers.get('retry-after'), '2');
	await new Promise((r) => setTimeout(r, 2000)); // the queue is paused for Retry-After
});

test('rate limit: requests spaced at RATE_PER_SEC for all users together', async () => {
	await reset();
	const t = await good();
	await Promise.all([
		...['R1', 'R2', 'R3'].map((id) => get(`/graph/v1/paper/${id}`, { 'zotero-api-key': MEMBER })),
		...['R4', 'R5'].map((id) => get(`/graph/v1/paper/${id}`, { authorization: `Bearer ${t}` }))
	]);
	const times = (await s2Requests()).map((s) => s.t).sort((a, b) => a - b);
	assert.equal(times.length, 5);
	for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 40, `gap ${times[i] - times[i - 1]} ms`);
});

test('POST batch and recommendations', async () => {
	await reset();
	const r = await fetch(`${BRIDGE}/graph/v1/paper/batch?fields=title`, {
		method: 'POST', headers: { 'zotero-api-key': MEMBER, 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['A', 'B'] })
	});
	assert.equal(r.status, 200);
	assert.deepEqual(await r.json(), [{ paperId: 'A' }, { paperId: 'B' }]);
	assert.equal((await get('/recommendations/v1/papers/forpaper/A', { 'zotero-api-key': MEMBER })).status, 200);
});

test('404 from Semantic Scholar passed through', async () => {
	assert.equal((await get('/graph/v1/paper/MISSING', { 'zotero-api-key': MEMBER })).status, 404);
});

test('client scopes: authors for the MCP client (openwebui), 403 for Semantic Zotero and Zotero keys', async () => {
	await reset();
	const mcp = await token({ aud: 'account', azp: 'openwebui', sub: 'user-mcp', realm_access: { roles: ['s2-users'] } });
	const r = await get('/graph/v1/author/1741101/papers?fields=title', { authorization: `Bearer ${mcp}` });
	assert.equal(r.status, 200);
	assert.equal((await get('/graph/v1/paper/M1', { authorization: `Bearer ${mcp}` })).status, 200);
	assert.equal((await get('/graph/v1/author/1741101', { authorization: `Bearer ${await good()}` })).status, 403);
	assert.equal((await get('/graph/v1/author/1741101', { 'zotero-api-key': MEMBER })).status, 403);
	const seen = await s2Requests();
	assert.deepEqual(seen.map((s) => s.path), ['/graph/v1/author/1741101/papers', '/graph/v1/paper/M1']);
	assert.equal(seen[0].headers['x-api-key'], 'bridge-key');
	assert.equal(seen[0].headers.authorization, undefined);
	assert.match(await (await get('/')).text(), /openwebui/);
});

test('queue cap: a looping agent gets 429 with Retry-After, others still get through', async () => {
	await reset();
	const agent = { authorization: `Bearer ${await token({ aud: 'account', azp: 'openwebui', sub: 'agent', realm_access: { roles: ['s2-users'] } })}` };
	const burst = Promise.all(Array.from({ length: 8 }, (_, i) => get(`/graph/v1/paper/Q${i}`, agent)));
	await new Promise((r) => setTimeout(r, 30));
	const other = await get('/graph/v1/paper/Q-other', { 'zotero-api-key': MEMBER });
	const statuses = (await burst).map((r) => r.status);
	assert.equal(other.status, 200);
	assert.ok(statuses.filter((s) => s === 429).length >= 4, `statuses ${statuses}`);
	assert.ok(statuses.filter((s) => s === 200).length >= 3, `statuses ${statuses}`);
	const refused = (await burst).find((r) => r.status === 429);
	assert.ok(Number(refused.headers.get('retry-after')) >= 1);
});
