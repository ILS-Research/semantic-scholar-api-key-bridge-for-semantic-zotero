# Changelog

## 0.1.0 (30.09.2026)

- First version: forwards read-only paper endpoints of the Semantic Scholar API with a shared key.
- Authentication via OIDC (JWKS, audience/azp, optional roles or groups) and/or Zotero group membership.
- Fair rate limiting, 429 retries with Retry-After, 503 with Retry-After when busy, shared response cache.
- Status page, `/healthz`, Docker image, unit and E2E tests.
