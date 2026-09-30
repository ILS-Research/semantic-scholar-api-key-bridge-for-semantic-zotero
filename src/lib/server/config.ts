/**
 * Configuration from environment variables (see README). parseConfig() is pure so it can be
 * tested; config() reads process.env once.
 */
import { SCOPES, type Scope } from './allowlist';

export type AuthMethod = 'oidc' | 'zotero-group';

export interface Config {
	s2ApiKey: string;
	s2BaseUrl: string;
	auth: AuthMethod[];
	oidc: {
		issuer: string;
		audience: string[];
		/** Any of these roles (realm or client roles) or groups is required; empty: any valid token. */
		requiredRoles: string[];
		requiredGroups: string[];
		/** Access level per OIDC client (audience); others get "papers". */
		clientScopes: Record<string, Scope>;
	};
	zotero: {
		apiUrl: string;
		groupIds: number[];
	};
	/** Requests per second to Semantic Scholar (all users together). */
	ratePerSec: number;
	/** Longest a request may wait in the queue before 503. */
	queueTimeoutMs: number;
	/** Requests one user may have waiting; more are refused with 429 at once. 0: no limit. */
	maxQueuedPerUser: number;
	/** Longest a request may retry after 429 from Semantic Scholar. */
	retryBudgetMs: number;
	cacheTtlMs: number;
	cacheNotFoundTtlMs: number;
	cacheMaxBytes: number;
	/** How long a successful authentication is remembered. */
	authCacheMs: number;
	/** Show counters on / (no user data). */
	statusPage: boolean;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function num(env: Record<string, string | undefined>, key: string, fallback: number, min: number): number {
	const raw = env[key];
	if (raw === undefined || raw === '') return fallback;
	const v = Number(raw);
	if (!Number.isFinite(v) || v < min) throw new Error(`${key} must be a number >= ${min}, got "${raw}"`);
	return v;
}

/** "client:scope,client:scope" → {client: scope} */
function clientScopes(v: string | undefined): Record<string, Scope> {
	const out: Record<string, Scope> = {};
	for (const entry of list(v)) {
		const i = entry.lastIndexOf(':');
		const [client, scope] = [entry.slice(0, i).trim(), entry.slice(i + 1).trim()];
		if (i <= 0 || !SCOPES.includes(scope as Scope)) {
			throw new Error(`OIDC_CLIENT_SCOPES: "${entry}" must be <client>:<${SCOPES.join('|')}>`);
		}
		out[client] = scope as Scope;
	}
	return out;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
	const auth = list(env.AUTH) as AuthMethod[];
	for (const a of auth) {
		if (a !== 'oidc' && a !== 'zotero-group') throw new Error(`AUTH: unknown method "${a}" (oidc, zotero-group)`);
	}
	if (!auth.length) throw new Error('AUTH must name at least one method: oidc, zotero-group');
	const cfg: Config = {
		s2ApiKey: env.S2_API_KEY ?? '',
		s2BaseUrl: (env.S2_BASE_URL || 'https://api.semanticscholar.org').replace(/\/+$/, ''),
		auth,
		oidc: {
			issuer: (env.OIDC_ISSUER ?? '').replace(/\/+$/, ''),
			audience: list(env.OIDC_AUDIENCE),
			requiredRoles: list(env.OIDC_REQUIRED_ROLES),
			requiredGroups: list(env.OIDC_REQUIRED_GROUPS),
			clientScopes: clientScopes(env.OIDC_CLIENT_SCOPES)
		},
		zotero: {
			apiUrl: (env.ZOTERO_API_URL || 'https://api.zotero.org').replace(/\/+$/, ''),
			groupIds: list(env.ZOTERO_GROUP_IDS).map((g) => {
				const id = Number(g);
				if (!Number.isInteger(id) || id <= 0) throw new Error(`ZOTERO_GROUP_IDS: "${g}" is not a group ID`);
				return id;
			})
		},
		ratePerSec: num(env, 'RATE_PER_SEC', 1, 0.01),
		queueTimeoutMs: num(env, 'QUEUE_TIMEOUT_SEC', 60, 1) * 1000,
		maxQueuedPerUser: num(env, 'MAX_QUEUED_PER_USER', 10, 0),
		retryBudgetMs: num(env, 'RETRY_BUDGET_SEC', 30, 0) * 1000,
		cacheTtlMs: num(env, 'CACHE_TTL_SEC', 86400, 0) * 1000,
		cacheNotFoundTtlMs: num(env, 'CACHE_NOT_FOUND_TTL_SEC', 3600, 0) * 1000,
		cacheMaxBytes: num(env, 'CACHE_MAX_MB', 256, 0) * 1024 * 1024,
		authCacheMs: num(env, 'AUTH_CACHE_SEC', 300, 0) * 1000,
		statusPage: (env.STATUS_PAGE ?? 'true') !== 'false'
	};
	if (auth.includes('oidc')) {
		if (!cfg.oidc.issuer) throw new Error('AUTH=oidc needs OIDC_ISSUER');
		if (!cfg.oidc.audience.length) throw new Error('AUTH=oidc needs OIDC_AUDIENCE (client IDs the tokens are issued for)');
		for (const c of Object.keys(cfg.oidc.clientScopes)) {
			if (!cfg.oidc.audience.includes(c)) throw new Error(`OIDC_CLIENT_SCOPES: client "${c}" is not in OIDC_AUDIENCE`);
		}
	}
	if (auth.includes('zotero-group') && !cfg.zotero.groupIds.length) {
		throw new Error('AUTH=zotero-group needs ZOTERO_GROUP_IDS');
	}
	return cfg;
}

let cached: Config | null = null;

export function config(): Config {
	return (cached ??= parseConfig(process.env));
}
