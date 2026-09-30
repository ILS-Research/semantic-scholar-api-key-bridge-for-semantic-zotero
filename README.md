# Semantic Scholar Bridge

Shares **one Semantic Scholar API key** with a group of people – an institute, a lab, a course –
so that their tools work reliably without everyone applying for a personal key. Clients so far:

- [Semantic Zotero](https://github.com/AgiNetz/semantic-zotero) – references and citations in Zotero
  (the project started as its bridge, hence the repository name), see [Keycloak](#keycloak);
- **MCP servers** for AI assistants, e.g. in [Open WebUI](https://openwebui.com), see
  [MCP servers / Open WebUI](#mcp-servers--open-webui);
- any other client of the Semantic Scholar Graph API that can send a bearer token or a Zotero key.

Without a key, all anonymous users worldwide share one small quota, and most requests end in
`HTTP 429`. With a personal key it works, but each person has to apply for one. The bridge sits in
between:

- **Authentication:** only your people may use the key – via your **OIDC provider** (e.g. Keycloak)
  or via membership in a **Zotero group**.
- **Rate limiting:** at most `RATE_PER_SEC` requests to Semantic Scholar for all users together,
  served round-robin per user, so one large batch does not block everyone else.
- **429 handling:** retries with `Retry-After` / backoff; if Semantic Scholar stays busy, the client
  gets `503` with `Retry-After`.
- **Cache:** identical requests are answered from memory (24 h by default), shared by all users.
- **Allowlist:** only read-only paper endpoints are forwarded; author endpoints only for clients you
  allow (see below).
- **Per-user cap:** a user with more than `MAX_QUEUED_PER_USER` waiting requests (e.g. an agent in a
  loop) gets `429` + `Retry-After` at once instead of crowding out everyone else.
- **Privacy:** user credentials are never forwarded to Semantic Scholar; the log contains a short
  hash per user, the method, the start of the path, status and duration – no keys, tokens or search terms.

The bridge is a small [SvelteKit](https://svelte.dev/docs/kit) app (Node adapter) and runs as a
single container without a database.

## Using it from a client

Point the client's Semantic Scholar base URL to the bridge, e.g. `https://bridge.example.org/graph/v1`
instead of `https://api.semanticscholar.org/graph/v1`, and authenticate with **one** of:

| Method | Header | Who |
|---|---|---|
| OIDC | `Authorization: Bearer <access token>` | accounts of the configured OIDC provider (optionally with a role or group) |
| Zotero group | `Zotero-API-Key: <key>` | members of the configured Zotero group(s) |

For the Zotero method, create a **separate key** at <https://www.zotero.org/settings/keys/new>
instead of using your sync key: the bridge only needs to know who you are and which groups you are
in. For a **public** group, a key without any permissions is enough; for a **private** group, give
the key read access to that group only.

Forwarded endpoints, in two access levels (everything else: `404`):

| Level | Endpoints | Who |
|---|---|---|
| `papers` | `GET /graph/v1/paper/…` (papers by any ID, references, citations, authors; search, `search/match`, `search/bulk`, `autocomplete`), `POST /graph/v1/paper/batch`, `GET /recommendations/v1/papers/forpaper/…`, `POST /recommendations/v1/papers` | everyone |
| `papers+authors` | additionally `GET /graph/v1/author/…` (author, their papers, author search), `POST /graph/v1/author/batch` | OIDC clients listed in `OIDC_CLIENT_SCOPES` |

Datasets, snippet search and releases are never forwarded. An author endpoint requested by a client
with level `papers` gets `403`.

Responses carry `X-Bridge-Cache: hit|miss`. Errors are JSON `{"error", "message"}`:
`401` (no or invalid credentials), `403` (valid, but not allowed for this account or client),
`404` (endpoint not forwarded), `429` + `Retry-After` (too many of your requests waiting),
`503` + `Retry-After` (Semantic Scholar busy), `502` (Semantic Scholar or the
authentication service unreachable).

## Running it

```sh
cp .env.example .env      # fill in S2_API_KEY and the authentication
docker compose -f docker-compose.example.yml up -d --build
```

Put it behind your HTTPS reverse proxy, on its own host name or under a path prefix that the proxy strips
(e.g. `https://example.org/s2/` → `http://bridge:8080/`). `GET /healthz` answers `ok`; `/` shows counters (no user
data; `STATUS_PAGE=false` hides them).

### Configuration

All settings are environment variables; see [.env.example](.env.example).

| Variable | Default | |
|---|---|---|
| `S2_API_KEY` | – | Semantic Scholar key (without one, the anonymous quota is used) |
| `AUTH` | – | `oidc`, `zotero-group` or `oidc,zotero-group` |
| `OIDC_ISSUER` | – | Issuer URL; the JWKS is found via `/.well-known/openid-configuration` |
| `OIDC_AUDIENCE` | – | Client ID(s); a token is accepted if `aud` contains one or `azp` equals one |
| `OIDC_CLIENT_SCOPES` | – | access level per client, e.g. `openwebui:papers+authors`; others get `papers` |
| `OIDC_REQUIRED_ROLES`, `OIDC_REQUIRED_GROUPS` | – | any of these (Keycloak realm/client roles, `roles`, `groups`) |
| `ZOTERO_GROUP_IDS` | – | Zotero group IDs (number in the group's URL) |
| `ZOTERO_API_URL` | `https://api.zotero.org` | also works with a self-hosted Zotero data server |
| `RATE_PER_SEC` | `1` | requests per second to Semantic Scholar |
| `MAX_QUEUED_PER_USER` | `10` | waiting requests per user before `429`; `0`: no limit |
| `QUEUE_TIMEOUT_SEC` | `60` | longest wait in the queue before `503` |
| `RETRY_BUDGET_SEC` | `30` | longest time spent retrying after `429` |
| `CACHE_TTL_SEC`, `CACHE_NOT_FOUND_TTL_SEC`, `CACHE_MAX_MB` | `86400`, `3600`, `256` | response cache |
| `AUTH_CACHE_SEC` | `300` | how long a successful authentication is remembered |

### Keycloak

Each client application gets its own Keycloak client; list all of them in `OIDC_AUDIENCE`.

For **Semantic Zotero**, create a **public** client (e.g. `semantic-zotero`) with *Standard flow*
and PKCE (S256); the redirect URI is `http://127.0.0.1:23119/semanticzotero/callback`. Set
`OIDC_ISSUER=https://<keycloak>/realms/<realm>` and `OIDC_AUDIENCE=semantic-zotero`. To limit
access, create a role and set `OIDC_REQUIRED_ROLES`.

## MCP servers / Open WebUI

An MCP server for Semantic Scholar (e.g. in [Open WebUI](https://openwebui.com)) can use the shared
key without any user having a key of their own:

1. Point the MCP server's Semantic Scholar addresses to the bridge
   (`https://<bridge>/graph/v1`, `https://<bridge>/recommendations/v1`) and remove its API key.
2. Let Open WebUI pass the signed-in user's OIDC access token to the tool server (OAuth forwarding),
   and let the MCP server forward that same `Authorization: Bearer` header to the bridge. Each person
   then has their own place in the fair queue and their own cap.
3. Allow the client the token is issued for (its `azp`, e.g. `openwebui`) and give it author
   lookups, which MCP tools use:
   ```
   OIDC_AUDIENCE=semantic-zotero,openwebui
   OIDC_CLIENT_SCOPES=openwebui:papers+authors
   ```
4. For calls without a signed-in person (background jobs, tests), the MCP server can fetch a token
   with the client-credentials grant of a confidential client (e.g. `semantic-scholar-mcp`) and add
   that client the same way. All such calls share one place in the queue.

The status page shows requests and average time per client (no user names).

## Development

Everything runs in Docker:

- `./build.sh` – install, typecheck, unit tests, build
- `./e2e/run.sh` – production image against mocks of Semantic Scholar, an OIDC provider and the
  Zotero API (Docker Compose, ~15 s)
- `./build.sh image` – local production image

## License

MIT, see [LICENSE](LICENSE). Not affiliated with Semantic Scholar / the Allen Institute for AI; mind
the [Semantic Scholar API license](https://www.semanticscholar.org/product/api/license) when
sharing a key.
