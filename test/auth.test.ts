import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Authenticator } from '../src/lib/server/auth';
import { oidcVerifier } from '../src/lib/server/auth/oidc';
import { AuthError } from '../src/lib/server/auth/types';
import { zoteroVerifier } from '../src/lib/server/auth/zotero';

describe('oidc', () => {
	let server: http.Server;
	let issuer = '';
	let key: CryptoKey;
	beforeAll(async () => {
		const pair = await generateKeyPair('RS256');
		key = pair.privateKey;
		const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
		server = http.createServer((req, res) => {
			res.setHeader('content-type', 'application/json');
			if (req.url?.endsWith('/.well-known/openid-configuration')) res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/certs` }));
			else if (req.url?.endsWith('/certs')) res.end(JSON.stringify({ keys: [jwk] }));
			else { res.statusCode = 404; res.end('{}'); }
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/test`;
	});
	afterAll(() => server.close());

	const token = (claims: Record<string, unknown>, opts: { iss?: string; exp?: string } = {}) =>
		new SignJWT({ sub: 'user-1', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuer(opts.iss ?? issuer).setIssuedAt().setExpirationTime(opts.exp ?? '5m').sign(key);
	const verifier = (extra: Partial<Parameters<typeof oidcVerifier>[0]> = {}) =>
		oidcVerifier({ issuer, audience: ['semantic-zotero'], requiredRoles: [], requiredGroups: [], ...extra });

	it('accepts a token for the audience, or with azp (Keycloak)', async () => {
		expect(await verifier()(await token({ aud: 'semantic-zotero' }))).toEqual({ id: 'oidc:user-1', method: 'oidc' });
		expect((await verifier()(await token({ aud: 'account', azp: 'semantic-zotero' }))).id).toBe('oidc:user-1');
	});
	it('refuses other audiences, issuers, expired and forged tokens', async () => {
		await expect(verifier()(await token({ aud: 'other' }))).rejects.toMatchObject({ status: 401 });
		await expect(verifier()(await token({ aud: 'semantic-zotero' }, { iss: 'https://evil' }))).rejects.toMatchObject({ status: 401 });
		await expect(verifier()(await token({ aud: 'semantic-zotero' }, { exp: '-1m' }))).rejects.toThrow('token expired');
		const other = (await generateKeyPair('RS256')).privateKey;
		const forged = await new SignJWT({ sub: 'x', aud: 'semantic-zotero' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuer(issuer).setExpirationTime('5m').sign(other);
		await expect(verifier()(forged)).rejects.toMatchObject({ status: 401 });
		await expect(verifier()('not-a-jwt')).rejects.toMatchObject({ status: 401 });
	});
	it('checks required roles and groups', async () => {
		const v = verifier({ requiredRoles: ['s2-users'], requiredGroups: ['/staff'] });
		await expect(v(await token({ aud: 'semantic-zotero' }))).rejects.toMatchObject({ status: 403 });
		expect(await v(await token({ aud: 'semantic-zotero', realm_access: { roles: ['s2-users'] } }))).toBeTruthy();
		expect(await v(await token({ aud: 'semantic-zotero', resource_access: { 'semantic-zotero': { roles: ['s2-users'] } } }))).toBeTruthy();
		expect(await v(await token({ aud: 'semantic-zotero', groups: ['/staff'] }))).toBeTruthy();
	});
});

describe('zotero group', () => {
	const KEY = 'AbCdEfGhIjKlMnOpQrStUvWx';
	const fetchFor = (groups: number[], validKey = KEY) => (async (url: string, init: any) => {
		const key = init.headers['Zotero-API-Key'];
		if (key !== validKey) return new Response('Forbidden', { status: 403 });
		if (url.endsWith('/keys/current')) return Response.json({ userID: 42, username: 'erika', access: {} });
		if (url.includes('/users/42/groups')) return Response.json(groups.map((id) => ({ id, data: { id, name: `g${id}` } })));
		return new Response('', { status: 404 });
	}) as any;

	it('member of a configured group', async () => {
		const v = zoteroVerifier({ apiUrl: 'https://z', groupIds: [7, 9], fetch: fetchFor([3, 9]) });
		expect(await v(KEY)).toEqual({ id: 'zotero:42', method: 'zotero-group' });
	});
	it('not a member: 403; invalid key: 401', async () => {
		const v = zoteroVerifier({ apiUrl: 'https://z', groupIds: [7], fetch: fetchFor([3]) });
		await expect(v(KEY)).rejects.toMatchObject({ status: 403 });
		await expect(v('WrongKeyWrongKeyWrongKey')).rejects.toMatchObject({ status: 401 });
		await expect(v('x')).rejects.toMatchObject({ status: 401 });
	});
});

describe('Authenticator', () => {
	it('picks the method by header, remembers results, reports disabled methods', async () => {
		let calls = 0;
		const auth = new Authenticator({
			'zotero-group': async (k) => { calls++; if (k === 'bad') throw new AuthError(403, 'no'); return { id: 'zotero:1', method: 'zotero-group' }; }
		}, 60_000);
		const h = (x: Record<string, string>) => new Headers(x);
		expect((await auth.authenticate(h({ 'zotero-api-key': 'good' }))).id).toBe('zotero:1');
		await auth.authenticate(h({ 'zotero-api-key': 'good' }));
		expect(calls).toBe(1);
		await expect(auth.authenticate(h({ 'zotero-api-key': 'bad' }))).rejects.toMatchObject({ status: 403 });
		await expect(auth.authenticate(h({ 'zotero-api-key': 'bad' }))).rejects.toMatchObject({ status: 403 });
		expect(calls).toBe(2);
		await expect(auth.authenticate(h({}))).rejects.toThrow(/Zotero-API-Key/);
		await expect(auth.authenticate(h({ authorization: 'Bearer abc' }))).rejects.toThrow(/oidc is not enabled/);
	});
});
