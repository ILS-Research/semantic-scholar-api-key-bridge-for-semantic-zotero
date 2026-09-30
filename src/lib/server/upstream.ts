/**
 * Requests to Semantic Scholar with the shared key. Every attempt waits for its turn in the
 * FairQueue; a 429 pauses the whole queue (Retry-After, else 1 s, 2 s, 4 s, …) and retries while
 * the retry budget lasts.
 */
import type { CachedResponse } from './cache';
import type { FairQueue } from './queue';

export class UpstreamBusy extends Error {
	constructor(readonly retryAfterSec: number) {
		super('Semantic Scholar rate limit');
	}
}

export class UpstreamError extends Error {}

export interface UpstreamRequest {
	method: string;
	/** Path and query, e.g. /graph/v1/paper/DOI:10.1/x/references?limit=10 */
	pathAndQuery: string;
	body?: Uint8Array;
	contentType?: string;
}

export interface UpstreamOptions {
	baseUrl: string;
	apiKey: string;
	retryBudgetMs: number;
	fetch?: typeof fetch;
	now?: () => number;
}

export function retryDelayMs(retryAfter: string | null, attempt: number): number {
	const sec = retryAfter === null ? NaN : Number(retryAfter);
	if (Number.isFinite(sec) && sec >= 0) return Math.min(sec, 120) * 1000;
	const date = retryAfter ? Date.parse(retryAfter) : NaN;
	if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 120_000));
	return Math.min(1000 * 2 ** attempt, 30_000);
}

export async function forward(
	req: UpstreamRequest,
	queue: FairQueue,
	user: string,
	opts: UpstreamOptions,
	signal?: AbortSignal,
	onRetry?: () => void
): Promise<CachedResponse> {
	const doFetch = opts.fetch ?? fetch;
	const now = opts.now ?? Date.now;
	const start = now();
	for (let attempt = 0; ; attempt++) {
		await queue.acquire(user, signal);
		const headers: Record<string, string> = { accept: 'application/json' };
		if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
		if (req.contentType) headers['content-type'] = req.contentType;
		let resp: Response;
		try {
			resp = await doFetch(opts.baseUrl + req.pathAndQuery, {
				method: req.method,
				headers,
				body: req.body as BodyInit | undefined,
				signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
			});
		} catch (e) {
			throw new UpstreamError((e as Error).message);
		}
		if (resp.status !== 429) {
			return {
				status: resp.status,
				contentType: resp.headers.get('content-type') || 'application/json',
				body: new Uint8Array(await resp.arrayBuffer())
			};
		}
		await resp.body?.cancel();
		const delay = retryDelayMs(resp.headers.get('retry-after'), attempt);
		queue.pause(delay);
		if (now() - start + delay > opts.retryBudgetMs) throw new UpstreamBusy(Math.ceil(delay / 1000));
		onRetry?.();
	}
}
