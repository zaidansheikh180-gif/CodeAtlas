# CodeAtlas architecture

Source of truth for how CodeAtlas is built. Anyone (human or LLM) reading only this file should understand the whole system. Update it in the same commit as any change that alters the design.

**Status: pre-code.** Nothing below is built yet. Everything is planned unless [PROGRESS.md](PROGRESS.md) says it shipped. Open decisions are listed at the end.

Related files: [README.md](README.md) (pitch), [ROADMAP.md](ROADMAP.md) (build order), [PROGRESS.md](PROGRESS.md) (dated log), [DESIGN.md](DESIGN.md) (UI rules). Planning documents: [PRD.md](PRD.md), [TRD.md](TRD.md), [APP_FLOW.md](APP_FLOW.md), [UI_UX_BRIEF.md](UI_UX_BRIEF.md), [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Product shape

Paste a public GitHub repository URL. CodeAtlas indexes it and shows two things on one screen:

- **The map:** an interactive, layered architecture graph of the codebase (modules, files, symbols, and the imports and calls between them). Free for everyone, no account, no key.
- **The chat:** questions answered from the actual code, with clickable `file:line` citations tied to the indexed commit. Needs the user's own model access (see section 6).

A map can be shared by link as a read-only view.

## 2. The four pieces

```
[ React frontend ]  --static host-->  free static hosting
        |
        v
[ API server ]  ---->  [ Supabase: Postgres + pgvector + Auth ]
        |                        self-hosted on a free-tier VM
        v
[ Indexing worker ]  --reads/writes-->  Supabase
        |
        +--> GitHub (shallow clone)
        +--> the user's own Gemini key or Ollama endpoint (embeddings, chat)
```

1. **Frontend** - React, Vite, Tailwind. Pages: landing with URL input and pre-indexed examples, repo view (map, source viewer and chat), settings (model mode), read-only share view. Canvas-based graph renderer. See [DESIGN.md](DESIGN.md).
2. **API server** - small service (Node/Fastify or Python/FastAPI, undecided). Submits indexing jobs, serves graph data for public repos without a key, runs the chat pipeline, manages per-user settings. Talks to Postgres directly.
3. **Indexing worker** - background process, one job at a time on the free-tier VM. Jobs live in a Postgres `jobs` table so a restart resumes the queue.
4. **Self-hosted Supabase** - Postgres, pgvector and Auth on a free-tier VM. Backups (a scheduled Postgres dump to object storage) are planned from day one.

## 3. Data flow: indexing

1. **Submit.** User pastes a public repo URL. The API validates it and creates a `repos` row and a `jobs` row.
2. **Clone.** Worker makes a shallow clone and records the commit hash.
3. **Filter.** Skip binaries, generated files and vendored code. Enforce the size caps (section 7). Run secret scanning; files that look like credentials are excluded and the exclusion is shown to the user.
4. **Parse.** Tree-sitter extracts functions, classes, imports and calls per file. First languages: JavaScript/TypeScript and Python (Go is a candidate). Unsupported languages degrade to "files only" and still get text chunks.
5. **Build the graph.** Nodes are files and symbols. Edges are `imports`, `calls`, `contains`, each tagged EXTRACTED (read from the syntax tree) or INFERRED (guessed). No LLM is involved, so this stage costs nothing per visitor and powers the no-key map.
6. **Chunk and embed (needs a model).** Split by function or class where possible. Embed with the submitter's own key or endpoint. Each embedding index records the model and dimension; vectors from different models never share an index.
7. **Summarize (optional).** One pass over the structure for a short project brief, using the submitter's key. Skipped without a key.

Progress is reported per stage (cloning, filtering, parsing, graph, embedding) so the UI can show real progress.

## 4. Data flow: chat

1. **Resolve the model.** The caller's Gemini key or Ollama endpoint. If neither exists, the API returns a clear "no key" response and the UI shows the setup state. There is no server-side fallback.
2. **Embed the question** with the same model as the repo's index.
3. **Retrieve two ways and merge.** Vector search for matching chunks, plus a graph walk from those chunks to callers, callees and importers.
4. **Rank and trim** to the context budget. Every chunk carries its path and line range.
5. **Prompt** with the question, the excerpts and strict instructions to answer only from the excerpts and cite `file:line`.
6. **Stream** the answer. Citations render as chips that open the source viewer at that line and highlight the matching map node.
7. **Verify citations** against the indexed commit. A line that cannot be found is flagged, not shown as fact. A valid line reference does not prove the explanation is correct, so the UI must also show what context the answer used.

## 5. Data model sketch

| Table | Holds |
|---|---|
| `repos` | URL, name, commit hash, status, owner (nullable for examples), `is_public`, summary |
| `files` | repo, path, language, size, content hash |
| `symbols` | file, kind, name, start and end line |
| `edges` | from, to, type (imports/calls/contains), confidence (extracted/inferred) |
| `chunks` | file, line range, text, embedding (pgvector), embedding model and dimension |
| `jobs` | repo, stage, progress, error, timestamps |
| `conversations`, `messages` | chat history per repo per user |
| `user_settings` | model mode, encrypted Gemini key, Ollama endpoint URL |

A shared map is a repo marked `is_public`; anonymous visitors get read-only map access. This is a sketch; the schema will be fixed in phase 1 and recorded here.

## 6. Model modes

All modes use the same chat pipeline; only the model client changes.

| Mode | What it does | Needs |
|---|---|---|
| No-key map browsing | Explore the graph and source | Nothing |
| BYO Gemini key | Embeddings and chat with the user's own key. Stored encrypted per user, used only for their requests, deletable any time | A free key from Google AI Studio |
| Own Ollama endpoint | The server proxies chat and embedding requests to the user's endpoint | A reachable endpoint with compatible chat and embedding models |

**Hard rule: no owner or shared key, ever.** No fallback to the project owner's personal key, and no default key in code or config. A missing key never consumes anyone else's quota. Provider limits and charges apply to the user's own key, and quota errors are shown honestly.

Open design work: safe handling of user-supplied Ollama URLs (a hosted server cannot reach a user's localhost, and arbitrary URLs raise server-side request risks), and key storage and logging rules. These are designed and tested before the modes ship.

## 7. Limits and safety

- **Size caps** on file count and total size after filtering. Exact values are set in phase 1 and recorded here. The cost estimate is shown before indexing.
- **Secret scanning** runs before any code reaches a model or an embedding index. Excluded files are listed.
- **Honest failures:** unsupported language, oversized repo, quota hit and unreachable endpoint each get a plain explanation, not a generic error.
- **Keys** are encrypted at rest and never logged.
- **Public repos only** at first. Private repo support (GitHub OAuth) is later work with its own scope review.

## 8. Current status

Pre-code. This repository holds documentation only: the README, roadmap, these source files and the planning documents linked from the README. No app, schema, server or demo exists. See [PROGRESS.md](PROGRESS.md) for the latest state.

## 9. Open decisions

- API framework (Fastify or FastAPI).
- Graph renderer and layout approach.
- Real headroom of the free-tier VM for Supabase, API and worker together (to be measured in phase 1).
- Exact size caps and chunking rules.
- Safe design for user-controlled Ollama endpoints.
- Embedding model choices per mode.
