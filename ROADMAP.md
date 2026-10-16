# CodeAtlas roadmap

CodeAtlas v1 is in build on the `instinct` branch (see [PROGRESS.md](PROGRESS.md)). This is the intended build order, not a release-date promise. The 62-item owner feature packs (2026-10-17) are mapped onto these phases in [FEATURE_PACK_PLAN.md](FEATURE_PACK_PLAN.md).

## Product shape

Paste a public GitHub repository URL, follow indexing progress, explore a layered architecture map and ask questions with clickable file-and-line citations. Pre-indexed graph-only examples should let visitors explore without an account or API key.

Chat and embeddings use the visitor's own Gemini key or their own reachable Ollama endpoint. There is no shared-key fallback. Model limits, costs and incomplete answers must be visible.

## Architecture

Update 2026-10-16 (evening, owner decision): v1 is static-only. The v1 architecture is:

- React, Vite and Tailwind frontend for the map, source viewer, chat and settings - this is the whole app.
- A Web Worker does tree-sitter (WASM) parsing, graph building and analytics; IndexedDB holds the index and chat history.
- The browser fetches public repositories from the GitHub API (the git tree listing plus raw file downloads - the zipball endpoint is not CORS-readable from a browser - and compare data as needed; the anonymous limit is about 60 requests/hour per visitor).
- Graph-assisted retrieval combines matching chunks with related symbols and checks citations against the indexed commit, all locally. Chat calls the visitor's own Gemini key or Ollama endpoint directly.

v2 (the original server plan, kept for that release):

- API for repository submission, graph retrieval, chat and user settings.
- Queued worker for shallow clones, filtering, secret scanning, tree-sitter parsing, symbol graphs and code chunks.
- Self-hosted Supabase on a free-tier VM, with PostgreSQL, pgvector and auth.

The API framework, graph renderer, hosting capacity and safe connection design for user-controlled model endpoints remain decisions to test. Embedding indexes must record the model and dimension; incompatible query embeddings cannot share an index.

## Phase 1: Prove the pipeline

Update 2026-10-16 (build): the browser pipeline ships on `instinct` - tree+raw fetching with timeouts and retry, worker parsing (JS/TS/TSX, Python), IndexedDB storage, per-stage progress, size caps and secret scanning.

Index one small public repository with a supplied key. Build the first schema, queue and retrieval endpoint. Return answers with source references in a minimal UI. Establish size limits and secret filtering before sending code to a model.

## Phase 2: Make the code explorable

Update 2026-10-16 (build): symbol extraction, import and call edges with confidence, the top-level module map and the source preview with syntax coloring ship on `instinct`; layered drill-down continues.

Add tree-sitter symbol extraction, imports and call edges, a layered map and a source viewer. Support no-key graph browsing and show unresolved relationships rather than inventing edges.

## Phase 3: Improve answer quality

Combine vector retrieval with graph context. Add streamed answers, citation checks, key setup and Ollama configuration, quota errors and responsive layouts. Test endpoint safety and keep keys out of logs and public data.

## Phase 4: Launch a tested demo

Prepare graph-only public examples, read-only share links and useful failure states. Deploy the app, measure indexing and answer quality, and write documentation from observed behavior. No public performance or parity claims before those checks.

## Phase 5: Add depth (moved into release one, 2026-10-16; split again 2026-10-16, evening)

Owner decision: these items are part of release one. They are ordered after the earlier phases but are not deferred to a later release. Update 2026-10-16 (evening): the static-only v1 decision carved the server-dependent items back out - the hosted MCP endpoint, the GitHub Action, account history, multi-repo registry, hosted share previews and embeds, and private repositories are v2. Everything that runs in a browser stays in v1. Original text follows. Build account history, incremental indexing, impact views, guided tours, exports and more language support. Evaluate private repositories, PR comparisons and agent integrations separately, with explicit access and privacy boundaries.

## Quality gates

- Source citations refer to the indexed commit, file and line range.
- Parsed facts are distinguishable from generated explanations.
- A missing model key never falls back to the project owner's quota.
- Repository limits and expected model use are shown before work starts.
- Secret scanning reduces exposure but is not a guarantee that a repository is safe to publish or send to a provider.
- Shipping requires tests, a usable demo and measured results, not only finished screens.
