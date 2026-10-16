# CodeAtlas technical requirements

Status: pre-code. Choices below are planned, and open ones are marked. Full system context lives in [ARCHITECTURE.md](ARCHITECTURE.md), which owns the design; this file is the quick stack lookup.

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| Frontend | React, Vite and Tailwind CSS. Canvas-based graph renderer (library TBD). Hosted as a static site. |
| Backend | A small API server plus a separate indexing worker. API framework: Node with Fastify or Python with FastAPI, undecided. The worker runs one job at a time and reads jobs from a Postgres `jobs` table. Parsing uses tree-sitter. |
| Database | PostgreSQL with pgvector, via self-hosted Supabase on a free-tier VM. Scheduled Postgres dumps to object storage planned from day one. |
| Auth | Supabase Auth is planned for per-user settings and saved keys. Sign-in methods: TBD. Map browsing needs no account. |
| Hosting | Frontend on free static hosting (provider TBD). API, worker and Supabase on one free-tier VM. Real headroom for all three together is unmeasured and will be tested in phase 1. |
| Third-party APIs | - GitHub (shallow clone of public repos): needed, free. Rate limits TBD.<br>- Google Gemini (embeddings and chat): the user's own key only, user's own quota and charges.<br>- Ollama (embeddings and chat): the user's own reachable endpoint, nothing for us to pay.<br>No service is paid for by the project owner at runtime. |
| Key Libraries | Tree-sitter (parsing). Graph renderer: TBD. Everything else TBD until phase 1. |
| Environment Variables | Names only, and not final. Likely needed: database connection URL, Supabase URL, Supabase service key, an encryption key for stored user keys, API port. No Gemini or other model key variable exists, by design. Exact list: TBD in phase 1. |
| Constraints | - No owner or shared model key, in code, config or fallback.<br>- Must run on one free-tier VM.<br>- Public repositories only at first.<br>- Repository size caps (values set in phase 1) and secret scanning before any code reaches a model or embedding index.<br>- User keys encrypted at rest and never logged.<br>- Embedding indexes record model and dimension; vectors from different models never share an index.<br>- Safe design for user-supplied Ollama URLs is required before that mode ships (a hosted server cannot reach a user's localhost, and arbitrary URLs raise server-side request risks).<br>- Mobile: layouts must work on phones.<br>- Languages first: JavaScript/TypeScript and Python (Go a candidate). Others degrade to files only. |

## Decision status

| Item | Status |
|---|---|
| React, Vite, Tailwind | Proposed |
| Self-hosted Supabase (Postgres, pgvector, Auth) | Chosen (owner, earlier plan) |
| tree-sitter parsing | Proposed |
| API framework (Fastify or FastAPI) | TBD |
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
| GitHub | Shallow clone of public repos, PR and commit data | Repo URL | None for public repos (rate limits TBD) | Free | Show not-found or rate-limit state |
| Gemini | Embeddings and chat | Code excerpts, questions | User's own key | User's quota | Quota state, no fallback |
| Ollama | Embeddings and chat | Code excerpts, questions | User's own endpoint | None to us | Unreachable state |

Quotas, timeouts, retries and retention: TBD, verified against official provider docs when each integration starts.

## Environment variables (names, purpose, exposure)

Status: TBD, not final. Database URL (server only), Supabase URL (client OK), Supabase service key (server only, secret), key-encryption secret (server only, secret), API port (server only). No model key variable exists, by design. No values are recorded here.

## Integration contracts and security

Endpoint list lives in [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) (API-001 onward). Hosted MCP endpoint, tokens and the GitHub Action (in v1, FR-039, FR-032; design first) need token auth, rate limits and abuse rules before any design is chosen. Secret handling: keys encrypted at rest, never logged. Backups: scheduled Postgres dumps (planned). Environment separation, monitoring and rollback: TBD.

## Folder structure and naming conventions

TBD. To be fixed when phase 1 starts and recorded here. Docs live at the repo root as uppercase `.md` files.

## Open questions

- API framework, graph renderer, static host.
- Exact size caps and chunking rules.
- Embedding model choice per mode.
- Final environment variable list.
- Graph analytics library (communities, centrality) and its fit on the VM.
- Token and rate-limit design for MCP and CI access (TASK-029; blocks FR-039, FR-032).
