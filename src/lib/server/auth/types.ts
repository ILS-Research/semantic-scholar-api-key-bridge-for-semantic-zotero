export interface Identity {
	/** Stable, method-prefixed user ID: queue fairness and (hashed) logging. */
	id: string;
	method: 'oidc' | 'zotero-group';
	/** OIDC: the configured audience the token was accepted for (usually its `azp`). */
	client?: string;
}

/** 401: no or invalid credentials; 403: valid, but not allowed. */
export class AuthError extends Error {
	constructor(readonly status: 401 | 403, message: string) {
		super(message);
	}
}
