/**
 * Fair rate limiter: at most one start per interval for all users together, taken round-robin
 * over the users' queues so one user's burst does not delay everyone else. A waiting request
 * gives up after `timeoutMs` (QueueTimeout) or when its signal aborts.
 */
export class QueueTimeout extends Error {
	constructor(readonly retryAfterSec: number) {
		super('queue timeout');
	}
}

interface Waiter {
	resolve: () => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class FairQueue {
	private queues = new Map<string, Waiter[]>();
	/** Round-robin order of users with waiting requests. */
	private order: string[] = [];
	private nextStart = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private intervalMs: number,
		private timeoutMs: number,
		private now: () => number = Date.now
	) {}

	/** Resolves when the caller may send its request. */
	acquire(user: string, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(new Error('aborted'));
			const waiter: Waiter = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.remove(user, waiter);
					reject(new QueueTimeout(Math.ceil(this.waiting * this.intervalMs / 1000) + 1));
				}, this.timeoutMs)
			};
			signal?.addEventListener('abort', () => {
				clearTimeout(waiter.timer);
				this.remove(user, waiter);
				reject(new Error('aborted'));
			}, { once: true });
			const q = this.queues.get(user);
			if (q) q.push(waiter);
			else {
				this.queues.set(user, [waiter]);
				this.order.push(user);
			}
			this.pump();
		});
	}

	/** Delays the next start, e.g. after Semantic Scholar answered 429. */
	pause(ms: number): void {
		this.nextStart = Math.max(this.nextStart, this.now() + ms);
		this.pump();
	}

	/** Requests of `user` waiting now. */
	queued(user: string): number {
		return this.queues.get(user)?.length ?? 0;
	}

	get waiting(): number {
		let n = 0;
		for (const q of this.queues.values()) n += q.length;
		return n;
	}

	private remove(user: string, waiter: Waiter): void {
		const q = this.queues.get(user);
		if (!q) return;
		const i = q.indexOf(waiter);
		if (i >= 0) q.splice(i, 1);
		if (!q.length) {
			this.queues.delete(user);
			this.order = this.order.filter((u) => u !== user);
		}
	}

	private pump(): void {
		if (this.timer || !this.order.length) return;
		const wait = this.nextStart - this.now();
		if (wait > 0) {
			this.timer = setTimeout(() => {
				this.timer = null;
				this.pump();
			}, wait);
			return;
		}
		const user = this.order.shift()!;
		const q = this.queues.get(user)!;
		const waiter = q.shift()!;
		if (q.length) this.order.push(user);
		else this.queues.delete(user);
		clearTimeout(waiter.timer);
		this.nextStart = this.now() + this.intervalMs;
		waiter.resolve();
		this.pump();
	}
}
