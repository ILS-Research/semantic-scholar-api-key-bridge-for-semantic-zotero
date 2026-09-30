/**
 * Configuration from environment variables (see README). parseConfig() is pure so it can be
 * tested; config() reads process.env once.
 */
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
	};
	zotero: {
		apiUrl: string;
		groupIds: number[];
	};
	/** Requests per second to Semantic Scholar (all users together). */
	ratePerSec: number;
	/** Longest a request may wait in the queue before 503. */
	queueTimeoutMs: number;
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
			requiredGroups: list(env.OIDC_REQUIRED_GROUPS)
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
		retryBudgetMs: num(env, 'RETRY_BUDGET_SEC', 30, 0) * 1000,
		cacheTtlMs: num(env, 'CACHE_TTL_SEC', 86400, 0) * 1000,
		cacheNotFoundTtlMs: num(env, 'CACHE_NOT_FOUND_TTL_SEC', 3600, 0) * 1000,
		cacheMaxBytes: num(env, 'CACHE_MAX_MB', 256, 0) * 1024 * 1024,
		authCacheMs: num(env, 'AUTH_CACHE_SEC', 300, 0) * 1000,
		statusPage: (env.STATUS_PAGE ?? 'true') !== 'false'
	};
	if (auth.includes('oidc')) {
		if (!cfg.oidc.issuer) throw new Error('AUTH=oidc needs OIDC_ISSUER');
		if (!cfg.oidc.audience.length) throw new Error('AUTH=oidc needs OIDC_AUDIENCE (client ID the tokens are issued for)');
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
