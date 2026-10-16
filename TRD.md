# CodeAtlas technical requirements

Status: pre-code. Choices below are planned, and open ones are marked.

Scope update 2026-10-16 (evening, owner decision): v1 is static-only - no backend server, no database server, no accounts. The Frontend and Third-party APIs rows below apply to v1; the Backend, Database, Auth and VM parts of Hosting describe v2 and are kept for that work. See the static-only v1 decision in [PRD.md](PRD.md). Full system context lives in [ARCHITECTURE.md](ARCHITECTURE.md), which owns the design; this file is the quick stack lookup.

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| Frontend | React, Vite and Tailwind CSS. Canvas-based graph renderer (library TBD). Hosted as a static site. Static v1 (2026-10-16, evening): this is the whole app - tree-sitter runs as WASM in a Web Worker, the graph and indexes live in IndexedDB, and model calls go directly from the browser to the visitor's own Gemini key or Ollama endpoint. |
| Backend | Superseded for v1 (2026-10-16, evening): v1 has no backend; indexing and retrieval run in the visitor's browser. Moved to v2. Original text: A small API server plus a separate indexing worker. API framework: Node with Fastify or Python with FastAPI, undecided. The worker runs one job at a time and reads jobs from a Postgres `jobs` table. Parsing uses tree-sitter. |
| Database | Static v1 (2026-10-16, evening): IndexedDB in the visitor's browser holds repos, files, symbols, edges, chunks, optional embedding vectors and chat history; the sketch is in [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md). Browser storage can be evicted under pressure, so nothing is durable. Superseded for v1, moved to v2: PostgreSQL with pgvector, via self-hosted Supabase on a free-tier VM. Scheduled Postgres dumps to object storage planned from day one. |
| Auth | Superseded for v1 (2026-10-16, evening): v1 has no accounts at all; settings (model mode, Gemini key, Ollama endpoint) live only in the visitor's browser storage. Moved to v2 with the server. Original text: Supabase Auth is planned for per-user settings and saved keys. Sign-in methods: TBD. Map browsing needs no account. |
| Hosting | Static v1 (2026-10-16, evening): free static hosting only (provider TBD). No VM in v1. Superseded for v1, moved to v2: API, worker and Supabase on one free-tier VM. Real headroom for all three together is unmeasured and will be tested in phase 1. |
| Third-party APIs | - GitHub: static v1 fetches public repos from the browser via the GitHub API - the repo archive (zipball) first, then file contents and compare data as needed. The anonymous limit is about 60 requests/hour per visitor IP; an optional visitor-supplied token stored only in their browser raises it (Chosen, owner, 2026-10-16 evening). Earlier plan (v2): server-side shallow clone.<br>- Google Gemini (embeddings and chat): the user's own key only, called directly from the browser; user's own quota and charges.<br>- Ollama (embeddings and chat): the user's own reachable endpoint, called directly from the browser; needs CORS enabled on the user's side (OLLAMA_ORIGINS), detected and explained by the setup card.<br>No service is paid for by the project owner at runtime. |
| Key Libraries | Tree-sitter (parsing). Graph renderer: TBD. Everything else TBD until phase 1. |
| Environment Variables | Static v1 (2026-10-16, evening): none server-side - there is no server. Any build-time variables (for example a base path) are TBD in phase 1. Superseded for v1, moved to v2: database connection URL, Supabase URL, Supabase service key, an encryption key for stored user keys, API port. No Gemini or other model key variable exists, by design, in either release. |
| Constraints | - No owner or shared model key, in code, config or fallback.<br>- Static v1 must run in one normal browser tab: parsing and graph building run in a Web Worker; size caps reflect browser memory (values set in phase 1). (Superseded for v1: must run on one free-tier VM - v2.)<br>- GitHub anonymous API limit (about 60 requests/hour per visitor IP) shapes the fetch design: archive first, extra requests only when needed, honest rate-limit state.<br>- Public repositories only at first.<br>- Repository size caps (values set in phase 1) and secret scanning before any code reaches a model or embedding index.<br>- User keys live only in the visitor's browser storage, sent nowhere but the chosen model provider, never logged. (v2, server plan: encrypted at rest.)<br>- Embedding indexes record model and dimension; vectors from different models never share an index.<br>- Ollama mode ships only with a setup card that detects CORS failures and explains the OLLAMA_ORIGINS fix (2026-10-16, evening; supersedes the server-side request-safety concern).<br>- Mobile: layouts must work on phones.<br>- Languages first: JavaScript/TypeScript and Python (Go a candidate). Others degrade to files only. |

## Decision status

| Item | Status |
|---|---|
| React, Vite, Tailwind | Proposed |
| Self-hosted Supabase (Postgres, pgvector, Auth) | Superseded for v1 (2026-10-16, evening): moved to v2 with the whole server plan |
| Static-only v1: no server, browser-only indexing, IndexedDB storage, direct browser-to-model calls | Chosen (owner, 2026-10-16, evening) |
| tree-sitter as WASM in a Web Worker | Chosen (2026-10-16, evening; the only way to parse in a browser tab without freezing it) |
| tree-sitter parsing | Proposed |
| API framework (Fastify or FastAPI) | TBD (v2 only; no API in v1) |
| Graph renderer | TBD |
| Graph analytics (communities, centrality) library | TBD |
| Static host | TBD |
| Gemini and Ollama as the only model providers | Chosen |
| No owner or shared model key | Chosen |

Nothing is Verified: no code or tooling exists yet.

## Runtime, toolchain and workflow

TBD. Language runtime, package manager, build, lint, type-check and test commands are fixed in phase 1 and recorded here with their real commands.

## Third-party services

| Service | Purpose | Data sent | Auth | Cost status | Failure behavior |
|---|---|---|---|---|---|
| GitHub | Repo archive and file contents for public repos, PR and commit-range data | Repo URL | None for public repos; anonymous limit about 60 requests/hour per visitor IP; optional visitor token (Chosen, 2026-10-16 evening) | Free | Show not-found or rate-limit state with wait time and the optional-token path |
| Gemini | Embeddings and chat | Code excerpts, questions | User's own key | User's quota | Quota state, no fallback |
| Ollama | Embeddings and chat | Code excerpts, questions | User's own endpoint | None to us | Unreachable state |

Quotas, timeouts, retries and retention: TBD, verified against official provider docs when each integration starts.

## Environment variables (names, purpose, exposure)

Status: TBD, not final. Database URL (server only), Supabase URL (client OK), Supabase service key (server only, secret), key-encryption secret (server only, secret), API port (server only). No model key variable exists, by design. No values are recorded here.

## Integration contracts and security

Static v1 (2026-10-16, evening): there are no API endpoints; the browser talks only to GitHub and the visitor's own model provider. The endpoint list in [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) (API-001 onward) is v2. The hosted MCP endpoint, tokens and the GitHub Action (FR-039, FR-032) moved to v2 with their token auth, rate-limit and abuse design (TASK-029). Secret handling (v1): keys live only in browser storage, never logged. Backups do not apply to v1 (browser storage is the visitor's own); scheduled Postgres dumps are v2. Environment separation, monitoring and rollback: TBD for v2; v1 static hosting rollback is a redeploy of the previous build.

## Folder structure and naming conventions

TBD. To be fixed when phase 1 starts and recorded here. Docs live at the repo root as uppercase `.md` files.

## Open questions

- Graph renderer, static host.
- Exact size caps and chunking rules (browser memory, phase 1).
- Embedding model choice per mode.
- Graph analytics library (communities, centrality) that runs well in a browser (WASM or JS).
- Decided 2026-10-16 (evening, owner): the optional visitor-supplied GitHub token (stored only in their browser) is in v1.
- Tree-sitter grammar set shipped as WASM: which grammars are bundled versus loaded on demand.
- v2 (deferred): API framework, final environment variable list, token and rate-limit design for MCP and CI access (TASK-029; blocks FR-039, FR-032).
