# Changelog

## 0.2.0 (30.09.2026)

- MCP servers / Open WebUI: several OIDC clients (`OIDC_AUDIENCE` list), access levels per client
  (`OIDC_CLIENT_SCOPES`, `papers` or `papers+authors`); author endpoints only for `papers+authors`
  (403 otherwise, unknown paths still 404, checked before authentication).
- Per-user cap `MAX_QUEUED_PER_USER` (default 10): more waiting requests get 429 + Retry-After at once.
- Status page: requests, forwarded requests and average time per client; refusals by scope and cap.

## 0.1.0 (30.09.2026)

- First version: forwards read-only paper endpoints of the Semantic Scholar API with a shared key.
- Authentication via OIDC (JWKS, audience/azp, optional roles or groups) and/or Zotero group membership.
- Fair rate limiting, 429 retries with Retry-After, 503 with Retry-After when busy, shared response cache.
- Status page, `/healthz`, Docker image, unit and E2E tests.
