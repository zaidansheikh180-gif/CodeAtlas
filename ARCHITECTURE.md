# CodeAtlas architecture

Source of truth for how CodeAtlas is built. Anyone (human or LLM) reading only this file should understand the whole system. Update it in the same commit as any change that alters the design.

**Status: pre-code.** Nothing below is built yet. Scope update 2026-10-16 (evening, owner decision): v1 is static-only - no server, no database server, no accounts. Sections below describe the original four-piece server design, now annotated: what runs in the browser in v1 and what moves to v2. The v2 design is kept for when a server returns. Everything is planned unless [PROGRESS.md](PROGRESS.md) says it shipped. Open decisions are listed at the end.

Status labels: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

Related files: [README.md](README.md) (pitch), [ROADMAP.md](ROADMAP.md) (build order), [PROGRESS.md](PROGRESS.md) (dated log), [DESIGN.md](DESIGN.md) (UI rules). Planning documents: [PRD.md](PRD.md), [TRD.md](TRD.md), [APP_FLOW.md](APP_FLOW.md), [UI_UX_BRIEF.md](UI_UX_BRIEF.md), [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Product shape

Paste a public GitHub repository URL. CodeAtlas indexes it and shows two things on one screen:

- **The map:** an interactive, layered architecture graph of the codebase (modules, files, symbols, and the imports and calls between them). Free for everyone, no account, no key.
- **The chat:** questions answered from the actual code, with clickable `file:line` citations tied to the indexed commit. Needs the user's own model access (see section 6).

A map can be shared by link as a read-only view. Static v1 (2026-10-16, evening): the link carries the repo, commit and view state, and the recipient's browser re-indexes the repo; the exported standalone HTML file is the share that opens instantly. Hosted share previews are v2.

## 2. The pieces

### v1: one piece (static-only, owner decision 2026-10-16, evening)

```
[ React frontend on free static hosting ]
        |
        +--> Web Worker: tree-sitter (WASM) parsing, graph building, analytics
        +--> IndexedDB: repos, files, symbols, edges, chunks, vectors, chats, settings
        |
        +--> GitHub API (recursive git tree for the file list, then raw file downloads
        |    from raw.githubusercontent.com - the zipball/codeload endpoint is not
        |    CORS-readable, measured 2026-10-16. Anonymous API limit ~60 requests/hour
        |    per visitor IP; raw downloads do not count against it. Optional visitor
        |    token, Chosen 2026-10-16)
        +--> the visitor's own Gemini key (embeddings, chat) - direct browser call
        +--> the visitor's own Ollama endpoint (embeddings, chat) - direct browser call,
             needs OLLAMA_ORIGINS set on the visitor's side
```

The frontend is the whole app. Indexing, retrieval, citation checks and exports all run in the visitor's browser. There is nothing of the project's to keep running, and nothing about a visitor is stored anywhere but their own browser.

### v2: the four pieces (superseded for v1 on 2026-10-16, evening; kept for the server release)

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
2. **API server** - small service (Node/Fastify or Python/FastAPI, undecided). Submits indexing jobs, serves graph data for public repos without a key, runs the chat pipeline, manages per-user settings. Talks to Postgres directly. (v2.)
3. **Indexing worker** - background process, one job at a time on the free-tier VM. Jobs live in a Postgres `jobs` table so a restart resumes the queue. (v2; in v1 the Web Worker is the worker and an IndexedDB `jobs` store is the queue.)
4. **Self-hosted Supabase** - Postgres, pgvector and Auth on a free-tier VM. Backups (a scheduled Postgres dump to object storage) are planned from day one. (v2; v1 uses IndexedDB and has no accounts.)

## 3. Data flow: indexing

Update 2026-10-16 (evening): in v1 every stage below runs in the visitor's browser. Submit creates rows in IndexedDB; instead of a server-side shallow clone, the browser reads the repo from GitHub and records the commit hash; parsing runs in a Web Worker. The server version below is the v2 flow. Update 2026-10-16 (late evening, measured): the zipball archive path was replaced - codeload.github.com answers with a CORS header that only allows render.githubusercontent.com, so no browser app can read the archive. The implemented flow: one recursive git-tree API request gives the file list (with sizes and blob hashes), filtering happens before download, and kept files download from raw.githubusercontent.com (CORS-open, not rate-limited like the API).

1. **Submit.** User pastes a public repo URL. The API validates it and creates a `repos` row and a `jobs` row.
2. **Clone.** Worker makes a shallow clone and records the commit hash.
3. **Filter.** Skip binaries, generated files and vendored code. Enforce the size caps (section 7). Run secret scanning; files that look like credentials are excluded and the exclusion is shown to the user.
4. **Parse.** Tree-sitter extracts functions, classes, imports and calls per file. First languages: JavaScript/TypeScript and Python (Go is a candidate). Unsupported languages degrade to "files only" and still get text chunks.
5. **Build the graph.** Nodes are files and symbols. Edges are `imports`, `calls`, `contains`, each tagged EXTRACTED (read from the syntax tree) or INFERRED (guessed). No LLM is involved, so this stage costs nothing per visitor and powers the no-key map.
6. **Chunk and embed (needs a model).** Split by function or class where possible. Embed with the visitor's own key or endpoint - called directly from the browser in v1. Each embedding index records the model and dimension; vectors from different models never share an index.
7. **Summarize (optional).** One pass over the structure for a short project brief, using the submitter's key. Skipped without a key.

Progress is reported per stage (cloning, filtering, parsing, graph, embedding) so the UI can show real progress.

## 4. Data flow: chat

1. **Resolve the model.** The caller's Gemini key or Ollama endpoint, called directly from the browser in v1. If neither exists, the UI shows the setup state. There is no fallback, server-side or otherwise.
2. **Embed the question** with the same model as the repo's index.
3. **Retrieve two ways and merge.** Vector search over the local vectors, plus a graph walk over the local graph from those chunks to callers, callees and importers. (Both run in the browser in v1.)
4. **Rank and trim** to the context budget. Every chunk carries its path and line range.
5. **Prompt** with the question, the excerpts and strict instructions to answer only from the excerpts and cite `file:line`.
6. **Stream** the answer. Citations render as chips that open the source viewer at that line and highlight the matching map node.
7. **Verify citations** against the indexed commit. A line that cannot be found is flagged, not shown as fact. A valid line reference does not prove the explanation is correct, so the UI must also show what context the answer used.

## 5. Data model sketch

Update 2026-10-16 (evening): the tables below are the v2 server schema. v1 keeps the same kinds of records in browser IndexedDB object stores; the v1 sketch is in [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) under "v1 local storage".

| Table | Holds |
|---|---|
| `repos` | URL, name, commit hash, status, owner (nullable for examples), `is_public`, summary |
| `files` | repo, path, language, size, content hash |
| `symbols` | file, kind, name, start and end line |
| `edges` | from, to, type (imports/calls/contains), confidence (extracted/inferred) |
| `chunks` | file, line range, text, embedding (pgvector), embedding model and dimension |
| `jobs` | repo, stage, progress, error, timestamps |
| `conversations`, `messages` | chat history per repo per user |
| `user_settings` | model mode, encrypted Gemini key, Ollama endpoint URL (v2; in v1 these live in the browser's settings store, unencrypted-at-rest but never leaving the browser except to the chosen provider) |

A shared map is a repo marked `is_public`; anonymous visitors get read-only map access. This is a sketch; the schema will be fixed in phase 1 and recorded here.

## 6. Model modes

All modes use the same chat pipeline; only the model client changes.

| Mode | What it does | Needs |
|---|---|---|
| No-key map browsing | Explore the graph and source | Nothing |
| BYO Gemini key | Embeddings and chat with the user's own key. Stored encrypted per user, used only for their requests, deletable any time | A free key from Google AI Studio |
| Own Ollama endpoint | The server proxies chat and embedding requests to the user's endpoint | A reachable endpoint with compatible chat and embedding models |

**Hard rule: no owner or shared key, ever.** No fallback to the project owner's personal key, and no default key in code or config. A missing key never consumes anyone else's quota. Provider limits and charges apply to the user's own key, and quota errors are shown honestly.

Open design work, updated 2026-10-16 (evening): the server-side Ollama concern is gone with the server - the browser calls the visitor's endpoint directly, so localhost works. The remaining v1 work is the CORS setup: Ollama must allow the site's origin (OLLAMA_ORIGINS), and the setup card must detect a CORS failure and explain the fix. Key handling in v1: keys live only in browser storage and are never logged. These are designed and tested before the modes ship.

## 7. Limits and safety

- **Size caps** on file count and total size after filtering. In v1 the caps reflect one browser tab's memory. Set in phase 1 (`src/lib/caps.ts`): 4,000 files, 25 MB of source text, 1 MB per file. Measured in phase 2 (2026-10-16): a medium repo (fastapi, 2873 files) indexes in about 67 s; a large repo (django, 3595 files, 41200 symbols, 97366 edges) processes end to end, and a storage-quota hit at save fails with a named, actionable error instead of a silent stall. The cost estimate is shown before indexing. See [PROGRESS.md](PROGRESS.md).
- **GitHub rate limit (added 2026-10-16, evening):** anonymous API use is limited to about 60 requests/hour per visitor IP. One index run costs 3 API requests (repo metadata, commit lookup, file tree); file contents come from raw.githubusercontent.com, which does not count against the limit. A rate-limit hit gets a named state with the wait time and the optional-token path (Chosen, owner, 2026-10-16 evening).
- **Secret scanning** runs before any code reaches a model or an embedding index. Excluded files are listed.
- **Honest failures:** unsupported language, oversized repo, quota hit and unreachable endpoint each get a plain explanation, not a generic error.
- **Keys** are encrypted at rest and never logged.
- **Public repos only** at first. Private repo support (GitHub OAuth) is v2 (accepted 2026-10-16).

## 8. Current status

Phase 1 built on the `instinct` branch (2026-10-16): the static app skeleton, Web Worker parsing pipeline (tree-sitter WASM; JS/TS/TSX and Python), IndexedDB storage (full v1 store set created at DB version 1), GitHub tree+raw fetching, secret scanning, per-stage progress, size caps, and the first top-level module map (canvas, d3-force) with a module file panel and source preview. Phase 3 (2026-10-17) added the indexing worker watchdog, curved map edges and Graph Query Mode: plain-English structural questions (imports, callers, impact, shortest paths) answered deterministically from the index with file:line citations and map highlights, no model key required. Phase 4 (2026-10-17) added repository search (off-main-thread worker, Ctrl/Cmd+K palette), the full source viewer, a file explorer, branch/tag/commit picking, incremental re-indexing, impact analysis with affected tests, call-flow visualization, and map upgrades (calls overlay, edge toggles, minimap, module expansion into file satellites). Phase 5 part 1 (2026-10-17) added deterministic greedy-modularity clustering in the search worker with community statistics, dominant-community map coloring, inspect-to-dim, and locally persisted community renames. Phase 5 part 2 (2026-10-17) added graph diagnostics: eight data-quality checks in the worker, a dashboard with severity and type filters, and JSON/Markdown export. Phase 5 part 3 (2026-10-17) added graph export/import: full-fidelity JSON export with filtered subsets, strict client-side import validation with id remapping and size guards, and architecture-map exports as JSON, Mermaid, GraphML and PNG. Phase 6 part 1 (2026-10-17) added repository snapshots: frozen full-graph records in a new snapshots store (IDB v2), openable as hidden snapshot views, with snapshot comparison math in src/lib/snapshots.ts. Part 2 added the compare view (src/components/CompareView.tsx) and the visual diff map (src/lib/diffmap.ts plus an edgeStatus prop on MapCanvas): union module graphs with nodes and edges colored by change status. Part 3a added the multi-repository global map (src/lib/globalgraph.ts, src/components/GlobalView.tsx): namespaced union module graph across indexed repos with per-repo colors, filtering and shared-name cross-repo links. Part 3b added graph merging (src/lib/merge.ts, src/components/MergeView.tsx): duplicate detection by tag+path+symbol, merged/separate/linked strategies, preview before materializing a merged imported view; imported views no longer offer Re-index. Phase 7 part 1 (2026-10-17) added feedback memory and lessons (src/lib/feedback.ts, src/components/FeedbackPanel.tsx, IDB v3): useful/dead-end/corrected ratings on graph answers steer future answer ranking with 30-day decay and a two-rating corroboration cap, corrections resurface on similar questions, and a lessons document plus JSON export/import live in the Feedback panel - all local, no LLM. Phase 8 (2026-10-17) added local folders. Part 1 (src/lib/localfolder.ts): a File System Access API picker walks and reads a folder on the device, then the same worker pipeline indexes it with no network calls; local repos are marked and never offer remote re-indexing. Part 2 added watch mode (src/lib/localwatch.ts, src/lib/handles.ts, src/components/WatchPanel.tsx): a 5s poll re-walk with quiet-scan debounce, manifest diffing with hash-confirmed add/modify/delete/rename detection, background incremental updates through the same pipeline (pruneRepoGraph removes rows for vanished paths), pause/resume/stop and permission park/deny handling; folder handles stay on the main thread (session registry plus best-effort IndexedDB persistence) and never enter the worker. Phase 9 part 1 (2026-10-17) added central error handling and observability (src/lib/errors.ts, src/components/StatusPanel.tsx, src/components/ErrorBoundary.tsx): categorized errors with friendly messages and redacted technical detail, a persistent 200-entry diagnostic log, retry with exponential backoff and cancellation, global rejection/error guards, a render-error boundary, and a Status panel with redacted JSON/Markdown export. Phase 9 part 2 (2026-10-17) added performance mode and budgets (src/lib/perf.ts): size-triggered low-detail map rendering with a manual toggle, traversal node/edge budgets with truncation flags in graphquery, and throughput/latency metrics in the indexing and answer UIs. Phase 9 parts 3+4 (2026-10-17) added the accessibility pass (keyboard-driven map, live regions, Escape dismissal, screen-reader map alternative) and onboarding (src/lib/onboarding.ts, src/components/Onboarding.tsx): first-run welcome with the three modes and privacy model, an 8-step skippable tour persisted in localStorage. Phase 7 part 1 (2026-10-17) added the settings page and privacy/key management (src/lib/settings.ts, src/lib/keys.ts, src/components/SettingsPanel.tsx): browser-persisted settings, memory-by-default keys with opt-in localStorage persistence (never IndexedDB), privacy report and one-click wipe, and a light theme variant. Phase 7 part 2 (2026-10-17) added memory-only GitHub tokens for private repos (landing field -> API calls and worker archive fetch, never persisted) and wired indexing settings (excluded globs/folders, file-size cap, sensitive-file globs, default-branch preference) into the pipeline. `main` holds documentation only. See [PROGRESS.md](PROGRESS.md) for measurements and the latest state.

### Folder structure (as built, phase 1)

- `src/lib/` - shared modules: github (API + raw URLs), caps, filter, secrets, db (IndexedDB), pipeline (worker protocol), modules (map aggregation), graphquery (key-free graph queries with citations), search (repository-wide search engine), types
- `src/workers/` - `index.worker.ts` (pipeline orchestration) and `parse.ts`, `graph.ts` (tree-sitter extraction and graph build, worker-side); `search.worker.ts` (off-main-thread repository search)
- `src/components/` - Landing, Indexing (progress), RepoView, MapCanvas
- Wasm grammars and the tree-sitter runtime load from npm packages (`web-tree-sitter`, `tree-sitter-wasms`) as Vite `?url` assets; no binaries live in the repo

## 10. Release-one scope and components (added 2026-10-16)

Status: Chosen (owner). Release one covers the functions of the related starred tools, listed with IDs in [PRD.md](PRD.md). The four pieces above stay; these responsibilities are added. All Planned.

Update 2026-10-16 (evening): with the static-only v1, the worker and API responsibilities below run in the browser (Web Worker and frontend code), except the token-protected agent endpoint and hosted share infrastructure, which are v2.

| Component | Added responsibility | Requirements |
|---|---|---|
| Indexing worker (v1: Web Worker) | Graph analytics (communities, hubs, bridges, surprise), execution flows, rationale and doc nodes, token counting and context trimming, commit-based incremental re-index | FR-010 to FR-014, FR-028, FR-033 |
| API server (v1: browser code; agent endpoint v2) | Search, path and explain, impact for symbols, PRs and commit ranges, share links, exports, packed-repo file, token-protected agent endpoint (v2) | FR-017, FR-018, FR-029 to FR-039 |
| Frontend | Impact, tour and share/export views; persona detail; non-visual tree | FR-015, FR-019 to FR-023, FR-034 to FR-038 |
| Model layer (user's own Gemini or Ollama, called directly from the browser) | Generated summaries, tours, domain view, wiki. Always labelled generated | FR-019 to FR-021, FR-038 |

Flow: impact request. API resolves the symbol or fetches the public PR or commit range, indexes the changed commit if needed, walks the graph for callers and callees, and returns affected symbols with a risk score and a list of what could not be resolved. Failure: PR missing or over the caps returns a named error. Data lives in the entities DATA-010 to DATA-019 in [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md).

Trust boundaries, updated 2026-10-16 (evening): downloaded repo contents are untrusted input (parsed in a worker, never executed); user keys never leave the browser except to the chosen provider; agent tokens are v2; user-supplied Ollama URLs are called only from the visitor's own browser, and the CORS setup is handled by the settings flow.

Not adopted from the inspiring tools, with reasons: see the table in [PRD.md](PRD.md).

## 11. Glossary

- **EXTRACTED / INFERRED:** an edge read directly from the syntax tree, or one guessed by resolution rules.
- **Blast radius:** the symbols likely affected by changing one symbol. A conservative estimate, not proof.
- **Community:** a cluster of closely linked nodes found by graph analysis.
- **Generated:** text written by a model. Always labelled and never mixed with parsed facts.

## 9. Open decisions

- Graph renderer and layout approach.
- Superseded 2026-10-16 (evening): free-tier VM headroom - no VM in v1. Replaced by: browser parse time and memory for repos under the caps (measured in phase 1), and whether graph analytics stay responsive in a worker for large repos (measure).
- Exact size caps and chunking rules.
- Ollama CORS setup flow (detection plus guidance for OLLAMA_ORIGINS) - replaces the retired server-side safety question.
- Embedding model choices per mode.
- Decided 2026-10-16 (evening, owner): the optional visitor-supplied GitHub token (stored only in their browser) is in v1.
- Decided 2026-10-16 (evening, owner): landing examples ship as bundled pre-built graphs with the static site.
- v2 (deferred): API framework (Fastify or FastAPI); token and abuse design for the agent endpoint (blocks FR-039).
