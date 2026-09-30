# Semantic Scholar Bridge

SvelteKit (adapter-node) service sharing one Semantic Scholar API key: OIDC or Zotero-group auth,
fair rate limiting, 429 retries, cache. Clients: the Semantic Zotero plugin (Zotero 7–10) and MCP servers (Open WebUI), with access levels per OIDC client. Public repo:
keep deployment-specific details (hosts, realms, client IDs, keys) out of it; they belong in the deployment.

| Task | Command | Log |
|---|---|---|
| Install, typecheck, unit tests, build | `./build.sh` | `logs/build.log` |
| E2E (production image + mocks, ~20 s) | `./e2e/run.sh` | `logs/e2e.log` |

- Host has no Node: everything in Docker. Keep Node/SvelteKit versions current.
- Request flow: `src/lib/server/bridge.ts` (allowlist → auth → cache → FairQueue → upstream).
- Tests against mocks only; live Semantic Scholar / Keycloak / zotero.org only on request.
- Open: whether a Zotero key needs read access for *private* group membership via
  `/users/{id}/groups` is assumed, not yet checked against api.zotero.org.
