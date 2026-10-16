# CodeAtlas technical requirements

Status: pre-code. Choices below are planned, and open ones are marked. Full system context lives in [ARCHITECTURE.md](ARCHITECTURE.md), which owns the design; this file is the quick stack lookup.

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

## Folder structure and naming conventions

TBD. To be fixed when phase 1 starts and recorded here. Docs live at the repo root as uppercase `.md` files.

## Open questions

- API framework, graph renderer, static host.
- Exact size caps and chunking rules.
- Embedding model choice per mode.
- Final environment variable list.
