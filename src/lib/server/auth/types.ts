export interface Identity {
	/** Stable, method-prefixed user ID: queue fairness and (hashed) logging. */
	id: string;
	method: 'oidc' | 'zotero-group';
	/** OIDC: the configured audience the token was accepted for (usually its `azp`). */
	client?: string;
}

/** 401: no or invalid credentials; 403: valid, but not allowed; 429: the auth service refuses for now. */
export class AuthError extends Error {
	constructor(readonly status: 401 | 403 | 429, message: string, readonly retryAfterSec?: number) {
		super(message);
	}
}

/** Request context a verifier may use. */
export interface AuthContext {
	/** Client address as reported by the trusted proxy (CLIENT_IP_HEADER), if configured. */
	clientIp?: string;
}
