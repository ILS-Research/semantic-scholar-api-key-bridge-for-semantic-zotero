import { describe, expect, it } from 'vitest';
import { isAllowed } from '../src/lib/server/allowlist';
import { ResponseCache } from '../src/lib/server/cache';
import { parseConfig } from '../src/lib/server/config';

describe('config', () => {
	const base = { AUTH: 'oidc', OIDC_ISSUER: 'https://kc/realms/x/', OIDC_AUDIENCE: 'semantic-zotero' };
	it('defaults', () => {
		const c = parseConfig(base);
		expect(c.s2BaseUrl).toBe('https://api.semanticscholar.org');
		expect(c.oidc.issuer).toBe('https://kc/realms/x');
		expect(c.ratePerSec).toBe(1);
		expect(c.zotero.apiUrl).toBe('https://api.zotero.org');
	});
	it('rejects incomplete setups', () => {
		expect(() => parseConfig({})).toThrow(/AUTH/);
		expect(() => parseConfig({ AUTH: 'ldap' })).toThrow(/unknown method/);
		expect(() => parseConfig({ AUTH: 'oidc' })).toThrow(/OIDC_ISSUER/);
		expect(() => parseConfig({ AUTH: 'zotero-group' })).toThrow(/ZOTERO_GROUP_IDS/);
		expect(() => parseConfig({ AUTH: 'zotero-group', ZOTERO_GROUP_IDS: 'abc' })).toThrow(/not a group ID/);
		expect(() => parseConfig({ ...base, RATE_PER_SEC: '0' })).toThrow(/RATE_PER_SEC/);
	});
	it('both methods', () => {
		const c = parseConfig({ ...base, AUTH: 'oidc, zotero-group', ZOTERO_GROUP_IDS: '12, 34' });
		expect(c.auth).toEqual(['oidc', 'zotero-group']);
		expect(c.zotero.groupIds).toEqual([12, 34]);
	});
});

describe('allowlist', () => {
	it.each([
		['GET', '/graph/v1/paper/DOI:10.1/x'],
		['GET', '/graph/v1/paper/abc123/references'],
		['GET', '/graph/v1/paper/abc123/citations'],
		['GET', '/graph/v1/paper/search'],
		['GET', '/graph/v1/paper/search/match'],
		['POST', '/graph/v1/paper/batch'],
		['GET', '/recommendations/v1/papers/forpaper/abc'],
		['POST', '/recommendations/v1/papers']
	])('allows %s %s', (m, p) => expect(isAllowed(m, p, 'papers')).toBe(true));
	it.each([
		['GET', '/datasets/v1/release'],
		['DELETE', '/graph/v1/paper/x'],
		['POST', '/graph/v1/paper/search'],
		['GET', '/graph/v1/paper/x/../../author/1'],
		['GET', '/graph/v1/snippet/search']
	])('refuses %s %s', (m, p) => expect(isAllowed(m, p)).toBe(false));
	it.each([
		['GET', '/graph/v1/author/123'],
		['GET', '/graph/v1/author/123/papers'],
		['GET', '/graph/v1/author/search'],
		['POST', '/graph/v1/author/batch']
	])('%s %s: only for papers+authors (coarse check allows it)', (m, p) => {
		expect(isAllowed(m, p, 'papers')).toBe(false);
		expect(isAllowed(m, p, 'papers+authors')).toBe(true);
		expect(isAllowed(m, p)).toBe(true);
	});
});

describe('client scopes', () => {
	const base = { AUTH: 'oidc', OIDC_ISSUER: 'https://kc/realms/r', OIDC_AUDIENCE: 'semantic-zotero, openwebui' };
	it('parses scopes per client, default none, and a queue cap', () => {
		const c = parseConfig({ ...base, OIDC_CLIENT_SCOPES: 'openwebui:papers+authors' });
		expect(c.oidc.audience).toEqual(['semantic-zotero', 'openwebui']);
		expect(c.oidc.clientScopes).toEqual({ openwebui: 'papers+authors' });
		expect(c.maxQueuedPerUser).toBe(10);
		expect(parseConfig({ ...base, MAX_QUEUED_PER_USER: '0' }).maxQueuedPerUser).toBe(0);
	});
	it('refuses unknown scopes and clients outside OIDC_AUDIENCE', () => {
		expect(() => parseConfig({ ...base, OIDC_CLIENT_SCOPES: 'openwebui:everything' })).toThrow(/OIDC_CLIENT_SCOPES/);
		expect(() => parseConfig({ ...base, OIDC_CLIENT_SCOPES: 'other:papers' })).toThrow(/not in OIDC_AUDIENCE/);
	});
});

describe('cache', () => {
	const body = (n: number) => ({ status: 200, contentType: 'application/json', body: new Uint8Array(n) });
	it('expires entries', () => {
		let t = 0;
		const c = new ResponseCache(1000, () => t);
		c.set('a', body(10), 100);
		expect(c.get('a')).not.toBeNull();
		t = 100;
		expect(c.get('a')).toBeNull();
	});
	it('evicts least recently used within the byte budget', () => {
		const c = new ResponseCache(250);
		c.set('a', body(99), 1000);
		c.set('b', body(99), 1000);
		c.get('a');
		c.set('c', body(99), 1000);
		expect(c.get('b')).toBeNull();
		expect(c.get('a')).not.toBeNull();
		expect(c.get('c')).not.toBeNull();
		expect(c.size.bytes).toBeLessThanOrEqual(250);
	});
	it('skips entries larger than the budget', () => {
		const c = new ResponseCache(50);
		c.set('big', body(100), 1000);
		expect(c.size.entries).toBe(0);
	});
});
