/**
 * OIDC: bearer access tokens (JWT) from the configured issuer, checked offline against the
 * issuer's JWKS (found via .well-known/openid-configuration). The token must be for one of the
 * configured audiences (`aud`, or `azp` as Keycloak access tokens often carry aud "account"), and
 * carry one of the required roles or groups if any are configured. Roles: Keycloak realm and
 * client roles (`realm_access`, `resource_access`) and a plain `roles` claim; groups: `groups`
 * (leading "/" ignored).
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { AuthError, type Identity } from './types';

export interface OidcOptions {
	issuer: string;
	audience: string[];
	requiredRoles: string[];
	requiredGroups: string[];
	fetch?: typeof fetch;
}

export function rolesOf(p: any): string[] {
	const roles = new Set<string>();
	for (const r of p?.realm_access?.roles ?? []) roles.add(String(r));
	for (const client of Object.values(p?.resource_access ?? {}) as any[]) for (const r of client?.roles ?? []) roles.add(String(r));
	for (const r of Array.isArray(p?.roles) ? p.roles : []) roles.add(String(r));
	return [...roles];
}

export function groupsOf(p: any): string[] {
	return (Array.isArray(p?.groups) ? p.groups : []).map((g: unknown) => String(g).replace(/^\//, ''));
}

/** Audience and role/group checks on a verified payload. */
export function checkClaims(p: JWTPayload & Record<string, any>, o: OidcOptions): void {
	const aud = Array.isArray(p.aud) ? p.aud : p.aud ? [p.aud] : [];
	if (!o.audience.some((a) => aud.includes(a) || p.azp === a)) throw new AuthError(401, 'token is not issued for this bridge');
	if (!o.requiredRoles.length && !o.requiredGroups.length) return;
	const roles = rolesOf(p);
	const groups = groupsOf(p);
	if (o.requiredRoles.some((r) => roles.includes(r)) || o.requiredGroups.some((g) => groups.includes(g.replace(/^\//, '')))) return;
	throw new AuthError(403, 'account lacks the required role or group');
}

export function oidcVerifier(o: OidcOptions): (token: string) => Promise<Identity> {
	let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
	const doFetch = o.fetch ?? fetch;
	const keys = async () => {
		if (jwks) return jwks;
		const resp = await doFetch(`${o.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
		if (!resp.ok) throw new Error(`OIDC discovery failed: HTTP ${resp.status}`);
		const meta = await resp.json();
		if (!meta.jwks_uri) throw new Error('OIDC discovery: no jwks_uri');
		jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
		return jwks;
	};
	return async (token) => {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(token, await keys(), { issuer: o.issuer }));
		} catch (e) {
			if (e instanceof errors.JWTExpired) throw new AuthError(401, 'token expired');
			if (e instanceof errors.JOSEError) throw new AuthError(401, 'invalid token');
			throw e;
		}
		checkClaims(payload as any, o);
		if (!payload.sub) throw new AuthError(401, 'token without subject');
		return { id: `oidc:${payload.sub}`, method: 'oidc' };
	};
}
