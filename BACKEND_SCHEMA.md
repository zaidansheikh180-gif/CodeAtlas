# CodeAtlas backend schema

Status: pre-code. This is a sketch from [ARCHITECTURE.md](ARCHITECTURE.md), section 5. Nothing is migrated. The schema gets fixed in phase 1 and recorded here. Column lists below are planned and some types are TBD.

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

## Indexes

TBD. Expected: vector index on chunks.embedding (per model and dimension), lookup indexes on repo_id, file_id and edge endpoints.

## Webhooks and triggers

None planned. The worker polls the jobs table.

## API endpoints

TBD. Planned areas: submit repo, job status, graph data for public repos (no key), chat, settings.

## Open questions

- Final column types and sign-in methods.
- Policy details and what repository content is stored.
- Whether anonymous users may submit repos or only open examples.
