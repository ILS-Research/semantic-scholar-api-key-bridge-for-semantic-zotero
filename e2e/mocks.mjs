// Mocks for the E2E tests, no dependencies:
//   :9001  Semantic Scholar  (records requests: GET /__requests, POST /__reset)
//   :9002  OIDC provider     (discovery, JWKS; POST /__token mints RS256 access tokens)
//   :9003  Zotero API        (/keys/current, /users/{id}/groups)
import crypto from 'node:crypto';
import http from 'node:http';

const json = (res, status, body, headers = {}) => {
	res.writeHead(status, { 'content-type': 'application/json', ...headers });
	res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });

// --- Semantic Scholar
const requests = [];
const counters = {};
http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	if (url.pathname === '/__requests') return json(res, 200, requests);
	if (url.pathname === '/__reset') { requests.length = 0; for (const k in counters) delete counters[k]; return json(res, 200, {}); }
	const body = await readBody(req);
	requests.push({ t: Date.now(), method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });
	const id = decodeURIComponent(url.pathname.replace(/^\/graph\/v1\/paper\//, '').replace(/\/references$/, ''));
	if (id === 'RATE429') {
		counters[id] = (counters[id] ?? 0) + 1;
		if (counters[id] <= 2) return json(res, 429, { message: 'Too Many Requests' }, { 'retry-after': '0' });
	}
	if (id === 'ALWAYS429') return json(res, 429, { message: 'Too Many Requests' }, { 'retry-after': '2' });
	if (id === 'MISSING') return json(res, 404, { error: 'Paper not found' });
	if (url.pathname === '/graph/v1/paper/batch') return json(res, 200, JSON.parse(body).ids.map((i) => ({ paperId: i })));
	json(res, 200, { paperId: id, data: [{ citedPaper: { paperId: 'R1', title: 'A reference' } }] });
}).listen(9001, '0.0.0.0');

// --- OIDC provider
const ISSUER = process.env.OIDC_ISSUER ?? 'http://mocks:9002/realms/test';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'mock-1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mint(claims) {
	const now = Math.floor(Date.now() / 1000);
	const payload = { iss: ISSUER, sub: 'user-1', iat: now, exp: now + 300, ...claims };
	const input = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'mock-1' })}.${b64(payload)}`;
	return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}
http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	if (url.pathname === '/realms/test/.well-known/openid-configuration') return json(res, 200, { issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` });
	if (url.pathname === '/realms/test/protocol/openid-connect/certs') return json(res, 200, { keys: [jwk] });
	if (url.pathname === '/__token') return json(res, 200, { access_token: mint(JSON.parse(await readBody(req) || '{}')) });
	json(res, 404, {});
}).listen(9002, '0.0.0.0');

// --- Zotero API: key "memberkey0123456789" (user 42, groups 4711 + 1), "otherkey0123456789" (user 43, group 1)
const KEYS = { memberkey0123456789: { userID: 42, groups: [4711, 1] }, otherkey0123456789: { userID: 43, groups: [1] } };
let zoteroCalls = 0;
http.createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	if (url.pathname === '/__calls') return json(res, 200, { calls: zoteroCalls });
	zoteroCalls++;
	const k = KEYS[req.headers['zotero-api-key']];
	if (!k) return json(res, 403, 'Forbidden');
	if (url.pathname === '/keys/current') return json(res, 200, { key: 'x', userID: k.userID, username: `u${k.userID}`, access: {} });
	if (url.pathname === `/users/${k.userID}/groups`) return json(res, 200, k.groups.map((id) => ({ id, data: { id, name: `Group ${id}` } })));
	json(res, 404, {});
}).listen(9003, '0.0.0.0');

console.log('mocks ready');
