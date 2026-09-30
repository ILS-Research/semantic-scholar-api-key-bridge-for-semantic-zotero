/**
 * Picks the method from the request (Authorization: Bearer → OIDC, Zotero-API-Key → Zotero group)
 * and remembers results per credential (hashed): successes for AUTH_CACHE_SEC, refusals for 30 s.
 */
import { createHash } from 'node:crypto';
import type { AuthMethod } from '../config';
import { AuthError, type Identity } from './types';

export type Verifier = (credential: string) => Promise<Identity>;

interface Remembered {
	result: Identity | AuthError;
	expires: number;
}

const REFUSAL_MS = 30_000;
const MAX_REMEMBERED = 10_000;

export class Authenticator {
	private remembered = new Map<string, Remembered>();

	constructor(
		private verifiers: Partial<Record<AuthMethod, Verifier>>,
		private cacheMs: number,
		private now: () => number = Date.now
	) {}

	async authenticate(headers: Headers): Promise<Identity> {
		const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '')?.[1];
		const zoteroKey = headers.get('zotero-api-key')?.trim();
		const [method, credential] = bearer ? (['oidc', bearer] as const) : zoteroKey ? (['zotero-group', zoteroKey] as const) : [null, null];
		if (!method || !credential) throw new AuthError(401, this.hint());
		const verify = this.verifiers[method];
		if (!verify) throw new AuthError(401, `${method} is not enabled on this bridge. ${this.hint()}`);

		const key = method + ':' + createHash('sha256').update(credential).digest('hex');
		const hit = this.remembered.get(key);
		if (hit && hit.expires > this.now()) {
			if (hit.result instanceof AuthError) throw hit.result;
			return hit.result;
		}
		try {
			const identity = await verify(credential);
			this.remember(key, identity, this.cacheMs);
			return identity;
		} catch (e) {
			if (e instanceof AuthError) this.remember(key, e, REFUSAL_MS);
			throw e;
		}
	}

	private remember(key: string, result: Identity | AuthError, ms: number): void {
		if (ms <= 0) return;
		if (this.remembered.size >= MAX_REMEMBERED) this.remembered.clear();
		this.remembered.set(key, { result, expires: this.now() + ms });
	}

	private hint(): string {
		const ways = [];
		if (this.verifiers.oidc) ways.push('Authorization: Bearer <OIDC access token>');
		if (this.verifiers['zotero-group']) ways.push('Zotero-API-Key: <key of a member of the Zotero group>');
		return `Authenticate with ${ways.join(' or ')}.`;
	}
}

export { AuthError, type Identity } from './types';
