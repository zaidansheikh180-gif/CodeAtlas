# CodeAtlas backend schema

Status: pre-code. This is a sketch from [ARCHITECTURE.md](ARCHITECTURE.md), section 5. Nothing is migrated. The schema gets fixed in phase 1 and recorded here. Column lists below are planned and some types are TBD.

Scope update 2026-10-16 (evening, owner decision): v1 is static-only - there is no server database in v1. Everything below the new v1 section describes the v2 server schema and is kept for that work. v1 stores the same kinds of records in the visitor's browser (IndexedDB); see the next section.

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.
No migration file exists, so every object here is Planned.

| Field | Content |
|---|---|
| Table: users | Managed by Supabase Auth (planned). Own profile columns: TBD. |
| Table: repos | id, url, name, commit_hash, status, owner_id (nullable for examples, FK to users), is_public, summary, created_at |
| Table: files | id, repo_id (FK), path, language, size, content_hash |
| Table: symbols | id, file_id (FK), kind, name, start_line, end_line |
| Table: edges | id, from (symbol or file), to (symbol or file), type (imports, calls, contains), confidence (extracted, inferred) |
| Table: chunks | id, file_id (FK), start_line, end_line, text, embedding (pgvector), embedding_model, embedding_dimension |
| Table: jobs | id, repo_id (FK), stage, progress, error, created_at, updated_at |
| Table: conversations | id, repo_id (FK), user_id (FK) |
| Table: messages | id, conversation_id (FK), role, content, citations, created_at |
| Table: user_settings | user_id (FK), model_mode, encrypted_gemini_key, ollama_endpoint_url |
| Relationships | repos 1-to-many files, files 1-to-many symbols and chunks, edges link symbols/files within a repo, jobs many-to-1 repos, conversations many-to-1 repos and users, messages many-to-1 conversations. Embedding indexes are separated by model and dimension. |
| Auth Provider | Supabase Auth (planned). Methods: TBD. |
| Row Level Security | Planned intent: public repos readable by anyone (read-only map); conversations, messages and user_settings readable and writable only by their owner; writes to repos, files, symbols, edges, chunks and jobs only by the API and worker. Exact policies: TBD in phase 1. |
| User Roles | Anonymous visitor (read public maps), signed-in user (own settings and chats). Admin role: TBD, likely not needed at first. |
| File Storage | No user file uploads planned. Repository contents are cloned by the worker; whether any file content is stored beyond chunk text is TBD. Database backups: scheduled dumps to object storage (planned). |
| Sensitive Fields | Gemini key: encrypted at rest, never logged, deletable by the user. Ollama endpoint URL: treated as sensitive; validated for safe use. Files flagged by secret scanning are excluded before indexing and the exclusion is listed. |

## v1 local storage (IndexedDB) - added 2026-10-16 (evening)

Status: Planned. v1 has no server, so the index and chat state live in the visitor's browser. Object stores (IndexedDB), mirroring the v2 tables:

| Store | Holds | v2 counterpart |
|---|---|---|
| repos | URL, name, commit hash, status, summary | DATA-001 |
| files | repo, path, language, size, content hash | DATA-002 |
| symbols | file, kind, name, start and end line | DATA-003 |
| edges | from, to, type, confidence (extracted/inferred) | DATA-004 |
| chunks | file, line range, text, optional embedding vector, embedding model and dimension | DATA-005 |
| jobs | repo, stage, progress, error (for pause/resume within the browser session) | DATA-006 |
| conversations, messages | chat history per repo, this browser only | DATA-007, DATA-008 |
| settings | model mode, Gemini key, Ollama endpoint - this browser only, sent nowhere but the chosen provider | DATA-009 |
| communities, graph_metrics, flows, rationale_notes, summaries, tours, analyses | analytics and generated content, computed in the browser | DATA-010 to DATA-016 |

Not in v1: users, share_links, api_tokens, repo_registry (DATA-017 to DATA-019) - they need a server and accounts, so they are v2. Invariants carry over: an edge connects nodes of one repo and one commit; generated rows always carry a generated flag; vectors from different models never share an index. Browser storage can be evicted under storage pressure, so the IndexedDB index is a cache, not a durable store; the standalone HTML export (FR-036) is the durable artifact. There is no RLS in v1: each browser holds only its owner's data.

## Entity IDs and release-one additions

Status: Planned. DATA-001 repos, DATA-002 files, DATA-003 symbols, DATA-004 edges, DATA-005 chunks, DATA-006 jobs, DATA-007 conversations, DATA-008 messages, DATA-009 user_settings (all described in the table above). Added for the 2026-10-16 scope decision (columns TBD). The v1/v2 split (2026-10-16, evening): DATA-010 to DATA-016 have v1 browser-store counterparts (table above); DATA-017, DATA-018 and DATA-019 are v2-only.

| ID | Entity | Purpose | Requirements |
|---|---|---|---|
| DATA-010 | communities | Cluster id, label, members per repo | FR-010 |
| DATA-011 | graph_metrics | Hub, bridge and surprise scores per node | FR-010, FR-011 |
| DATA-012 | flows | Entry point and ordered call chain | FR-012 |
| DATA-013 | rationale_notes | Comment and doc references linked to code | FR-013 |
| DATA-014 | summaries | Generated text per node, with model and a generated flag | FR-019 |
| DATA-015 | tours | Ordered steps per repo and persona | FR-020, FR-022 |
| DATA-016 | analyses | Impact results for a symbol, PR or commit range | FR-029 to FR-031 |
| DATA-017 | share_links | Slug, repo, view state, preview image | FR-034, FR-035 |
| DATA-018 | api_tokens | Hashed tokens for agent access (in v1; design first) | FR-039 |
| DATA-019 | repo_registry | User's registered repos (needs accounts) | FR-041 |

Invariants: an edge connects nodes of one repo and one commit; generated rows always carry a generated flag; vectors from different models never share an index.

## Access matrix

Status: Proposed. v2-only (2026-10-16, evening): v1 is single-user per browser, so no access matrix applies. Anonymous: read public repos, maps, shares. Signed-in user: own settings, chats, tokens, registry. API and worker only: write repos, files, symbols, edges, chunks, jobs, communities, metrics, flows, rationale notes, analyses. Cross-user and unauthorised-access tests are required (TEST IDs assigned when RLS is written).

## API catalogue

Status: Planned, paths TBD. Superseded for v1 (2026-10-16, evening): v1 has no API - the browser talks only to GitHub and the visitor's own model provider. This catalogue is v2. API-001 submit repo. API-002 job status. API-003 graph data (public, no key). API-004 node source and callers/callees. API-005 search. API-006 path and explain. API-007 chat (streamed). API-008 settings. API-009 impact (symbol, PR, commits). API-010 tours and summaries. API-011 share link create and read. API-012 exports. API-013 packed-repo file. API-014 MCP endpoint (v2 per the 2026-10-16 evening decision). Each gets auth, input and output schema, errors, rate limits and idempotency when designed.

## Migration and rollback

TBD. Order: core tables (DATA-001 to DATA-006), then analytics and generated-content tables, then sharing and tokens. Each migration gets a verification query and a forward-fix note.

## Indexes

TBD. Expected: vector index on chunks.embedding (per model and dimension), lookup indexes on repo_id, file_id and edge endpoints.

## Webhooks and triggers

None planned. The worker polls the jobs table.

## API endpoints

TBD. Planned areas: submit repo, job status, graph data for public repos (no key), chat, settings.

## Open questions

- v1: IndexedDB store shapes, indexes, and how much repository content is kept beyond chunk text.
- v1: eviction handling - detect a missing or partial cache and offer re-index.
- v2 (deferred): final column types and sign-in methods; policy details; whether anonymous users may submit repos; column definitions for DATA-017 to DATA-019; token hashing and rate-limit design for DATA-018 (blocks FR-039).
