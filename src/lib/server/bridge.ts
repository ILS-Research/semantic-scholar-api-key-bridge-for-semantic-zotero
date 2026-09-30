/**
 * The bridge: allowlist → authentication → cache → fair queue → Semantic Scholar.
 * Responses carry X-Bridge-Cache: hit|miss. Errors are JSON {error, message}.
 */
import { createHash } from 'node:crypto';
import { isAllowed } from './allowlist';
import { Authenticator, AuthError, type Verifier } from './auth';
import { oidcVerifier } from './auth/oidc';
import { zoteroVerifier } from './auth/zotero';
import { ResponseCache } from './cache';
import type { Config } from './config';
import { FairQueue, QueueTimeout } from './queue';
import { stats } from './stats';
import { forward, UpstreamBusy, UpstreamError } from './upstream';

const MAX_BODY = 1024 * 1024;

export interface BridgeDeps {
	fetch?: typeof fetch;
	verifiers?: Partial<Record<'oidc' | 'zotero-group', Verifier>>;
}

function json(status: number, error: string, message: string, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify({ error, message }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
	});
}

function log(msg: string): void {
	console.log(`${new Date().toISOString()} ${msg}`);
}

/** Short, non-reversible user tag for logs. */
function tag(id: string): string {
	return createHash('sha256').update(id).digest('hex').slice(0, 10);
}

export class Bridge {
	readonly cache: ResponseCache;
	readonly queue: FairQueue;
	private auth: Authenticator;

	constructor(private cfg: Config, private deps: BridgeDeps = {}) {
		this.cache = new ResponseCache(cfg.cacheMaxBytes);
		this.queue = new FairQueue(1000 / cfg.ratePerSec, cfg.queueTimeoutMs);
		const verifiers = deps.verifiers ?? {
			...(cfg.auth.includes('oidc') ? { oidc: oidcVerifier({ ...cfg.oidc, fetch: deps.fetch }) } : {}),
			...(cfg.auth.includes('zotero-group') ? { 'zotero-group': zoteroVerifier({ ...cfg.zotero, fetch: deps.fetch }) } : {})
		};
		this.auth = new Authenticator(verifiers, cfg.authCacheMs);
	}

	async handle(request: Request): Promise<Response> {
		stats.requests++;
		const url = new URL(request.url);
		const method = request.method;
		if (!isAllowed(method, url.pathname)) {
			stats.rejectedPath++;
			return json(404, 'not_allowed', 'This endpoint is not available through the bridge.');
		}

		let userId: string;
		try {
			userId = (await this.auth.authenticate(request.headers)).id;
		} catch (e) {
			if (e instanceof AuthError) {
				stats.rejectedAuth++;
				return json(e.status, e.status === 401 ? 'unauthorized' : 'forbidden', e.message,
					e.status === 401 ? { 'www-authenticate': 'Bearer' } : {});
			}
			stats.errors++;
			log(`auth backend error: ${(e as Error).message}`);
			return json(502, 'auth_unavailable', 'The authentication service could not be reached.');
		}

		let body: Uint8Array | undefined;
		if (method === 'POST') {
			body = new Uint8Array(await request.arrayBuffer());
			if (body.byteLength > MAX_BODY) return json(413, 'too_large', 'Request body too large.');
		}
		const pathAndQuery = url.pathname + url.search;
		const cacheKey = `${method} ${pathAndQuery}${body ? ' ' + createHash('sha256').update(body).digest('hex') : ''}`;
		const hit = this.cache.get(cacheKey);
		if (hit) {
			stats.cacheHits++;
			return this.respond(hit, 'hit');
		}

		const t0 = Date.now();
		try {
			const res = await forward(
				{ method, pathAndQuery, body, contentType: request.headers.get('content-type') ?? undefined },
				this.queue,
				userId,
				{ baseUrl: this.cfg.s2BaseUrl, apiKey: this.cfg.s2ApiKey, retryBudgetMs: this.cfg.retryBudgetMs, fetch: this.deps.fetch },
				request.signal,
				() => stats.upstreamRetries++
			);
			stats.upstreamRequests++;
			if (res.status === 200) this.cache.set(cacheKey, res, this.cfg.cacheTtlMs);
			else if (res.status === 404) this.cache.set(cacheKey, res, this.cfg.cacheNotFoundTtlMs);
			log(`${tag(userId)} ${method} ${url.pathname.split('/').slice(0, 4).join('/')}… ${res.status} ${Date.now() - t0} ms`);
			return this.respond(res, 'miss');
		} catch (e) {
			if (e instanceof QueueTimeout || e instanceof UpstreamBusy) {
				stats.busy++;
				return json(503, 'busy', 'Semantic Scholar is busy; try again later.', { 'retry-after': String(e.retryAfterSec) });
			}
			if (request.signal.aborted) return json(499, 'aborted', 'Request aborted.');
			stats.errors++;
			log(`upstream error: ${(e as Error).message}`);
			return json(502, e instanceof UpstreamError ? 'upstream_unreachable' : 'error', 'Semantic Scholar could not be reached.');
		}
	}

	private respond(r: { status: number; contentType: string; body: Uint8Array }, cache: 'hit' | 'miss'): Response {
		return new Response(r.body as BodyInit, {
			status: r.status,
			headers: { 'content-type': r.contentType, 'cache-control': 'no-store', 'x-bridge-cache': cache }
		});
	}
}

let instance: Bridge | null = null;

export function bridge(cfg: Config): Bridge {
	return (instance ??= new Bridge(cfg));
}
