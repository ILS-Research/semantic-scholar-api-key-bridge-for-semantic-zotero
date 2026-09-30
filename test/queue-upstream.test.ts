import { describe, expect, it } from 'vitest';
import { FairQueue, QueueTimeout } from '../src/lib/server/queue';
import { forward, retryDelayMs, UpstreamBusy } from '../src/lib/server/upstream';

describe('FairQueue', () => {
	it('spaces starts and serves users round-robin', async () => {
		const q = new FairQueue(20, 5000);
		const order: string[] = [];
		const times: number[] = [];
		const t0 = Date.now();
		const run = (u: string) => q.acquire(u).then(() => { order.push(u); times.push(Date.now() - t0); });
		await Promise.all([run('a'), run('a'), run('a'), run('b')]);
		expect(times[0]).toBeLessThan(15);
		// a's first request starts at once; b then goes before a's remaining ones
		expect(order).toEqual(['a', 'a', 'b', 'a']);
		for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(15);
	});
	it('times out waiting requests', async () => {
		const q = new FairQueue(10_000, 50);
		await q.acquire('a');
		await expect(q.acquire('a')).rejects.toBeInstanceOf(QueueTimeout);
		expect(q.waiting).toBe(0);
	});
	it('pause delays the next start', async () => {
		const q = new FairQueue(1, 5000);
		q.pause(80);
		const t0 = Date.now();
		await q.acquire('a');
		expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
	});
	it('abort removes the waiter', async () => {
		const q = new FairQueue(10_000, 5000);
		await q.acquire('a');
		const ac = new AbortController();
		const p = q.acquire('a', ac.signal);
		ac.abort();
		await expect(p).rejects.toThrow('aborted');
		expect(q.waiting).toBe(0);
	});
});

describe('upstream', () => {
	it('retryDelayMs: Retry-After seconds, else exponential', () => {
		expect(retryDelayMs('3', 0)).toBe(3000);
		expect(retryDelayMs(null, 0)).toBe(1000);
		expect(retryDelayMs(null, 3)).toBe(8000);
		expect(retryDelayMs('garbage', 1)).toBe(2000);
	});

	const res = (status: number, body = '{}', headers: Record<string, string> = {}) =>
		new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

	it('retries after 429 and sends the key', async () => {
		const seen: any[] = [];
		const answers = [res(429, '', { 'retry-after': '0' }), res(200, '{"ok":1}')];
		const fetch = (async (url: string, init: any) => { seen.push({ url, init }); return answers.shift()!; }) as any;
		let retries = 0;
		const r = await forward({ method: 'GET', pathAndQuery: '/graph/v1/paper/x?fields=title' }, new FairQueue(1, 5000), 'u',
			{ baseUrl: 'https://s2', apiKey: 'K', retryBudgetMs: 5000, fetch }, undefined, () => retries++);
		expect(r.status).toBe(200);
		expect(new TextDecoder().decode(r.body)).toBe('{"ok":1}');
		expect(retries).toBe(1);
		expect(seen[0].url).toBe('https://s2/graph/v1/paper/x?fields=title');
		expect(seen[0].init.headers['x-api-key']).toBe('K');
	});

	it('gives up when the retry budget is spent', async () => {
		const fetch = (async () => res(429, '', { 'retry-after': '5' })) as any;
		await expect(forward({ method: 'GET', pathAndQuery: '/x' }, new FairQueue(1, 5000), 'u',
			{ baseUrl: 'https://s2', apiKey: '', retryBudgetMs: 1000, fetch })).rejects.toBeInstanceOf(UpstreamBusy);
	});

	it('no key: no x-api-key header', async () => {
		let headers: any;
		const fetch = (async (_u: string, init: any) => { headers = init.headers; return res(200); }) as any;
		await forward({ method: 'GET', pathAndQuery: '/x' }, new FairQueue(1, 5000), 'u', { baseUrl: 'https://s2', apiKey: '', retryBudgetMs: 0, fetch });
		expect(headers['x-api-key']).toBeUndefined();
	});
});
