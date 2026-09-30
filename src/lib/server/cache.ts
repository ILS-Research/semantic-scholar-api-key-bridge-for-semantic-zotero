/** In-memory response cache with a byte budget (least recently used entries go first) and TTL. */
export interface CachedResponse {
	status: number;
	contentType: string;
	body: Uint8Array;
}

interface Entry {
	value: CachedResponse;
	expires: number;
}

export class ResponseCache {
	private entries = new Map<string, Entry>();
	private bytes = 0;

	constructor(private maxBytes: number, private now: () => number = Date.now) {}

	get(key: string): CachedResponse | null {
		const e = this.entries.get(key);
		if (!e) return null;
		if (e.expires <= this.now()) {
			this.delete(key);
			return null;
		}
		// Map keeps insertion order: re-insert to mark as recently used
		this.entries.delete(key);
		this.entries.set(key, e);
		return e.value;
	}

	set(key: string, value: CachedResponse, ttlMs: number): void {
		const size = value.body.byteLength + key.length;
		if (ttlMs <= 0 || size > this.maxBytes) return;
		this.delete(key);
		this.entries.set(key, { value, expires: this.now() + ttlMs });
		this.bytes += size;
		for (const k of this.entries.keys()) {
			if (this.bytes <= this.maxBytes) break;
			this.delete(k);
		}
	}

	private delete(key: string): void {
		const e = this.entries.get(key);
		if (!e) return;
		this.bytes -= e.value.body.byteLength + key.length;
		this.entries.delete(key);
	}

	get size(): { entries: number; bytes: number } {
		return { entries: this.entries.size, bytes: this.bytes };
	}
}
