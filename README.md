# CodeAtlas

Understand a codebase before you change it.

CodeAtlas is a planned web app that turns a public GitHub repository into an interactive architecture map. Explore files, symbols and dependencies, then ask questions with answers grounded in the actual code and clickable `file:line` citations.


Understand a codebase before you change it.

CodeAtlas is a planned web app that turns a public GitHub repository into an interactive architecture map. Explore files, symbols and dependencies, then ask questions with answers grounded in the actual code and clickable `file:line` citations.

**Status: v1 in build.** The browser spine (indexing pipeline, IndexedDB storage, module map, source preview) is built and measured on the `instinct` branch (see [PROGRESS.md](PROGRESS.md)); chat, settings and sharing are planned. There is no deployed demo yet.

Release one is planned to include the functions of the related code-graph and repository tools, not a smaller subset. The full list with IDs and any items still undecided is in [PRD.md](PRD.md).

## The experience

1. Paste a public GitHub repository URL or open a pre-indexed example.
2. Follow indexing progress as the worker downloads and parses the repository.
3. Explore a layered map, select a node and read its source.
4. Bring your own model to ask questions about the code.
5. Share a read-only map link so someone else can explore without installing anything. (v1: the link re-indexes the repo in the recipient's browser; the exported standalone HTML map opens instantly.)

The goal is a readable architecture view, not a wall of nodes. Start with the major modules and drill down to the files and functions behind them.

## Your model, your quota

| Mode | Intended behavior |
| --- | --- |
| No-key map browsing | Explore parsed structure and source without a model key. Graph-only indexing does not need an LLM. |
| BYO Gemini key | Use your own Gemini API key for embeddings and chat. Provider limits and charges apply to your key. |
| Your own Ollama endpoint | Use your own reachable endpoint and compatible chat and embedding models. Localhost on your computer is not reachable from a hosted server without an explicit connection design. |

There is no fallback to the project owner's personal key. A missing key must not silently consume someone else's quota. Saved-key handling, endpoint safety and embedding compatibility will be designed and tested before these modes ship.

## Answers you can inspect

The planned retrieval pipeline combines code chunks with graph context: callers, callees and imports. Answers will link back to the indexed commit, file and line range, with citations checked against that snapshot. A valid line reference is not proof that an AI's explanation is correct; uncertain relationships and incomplete context should remain visible.

## Planned stack

Update 2026-10-16 (evening, owner decision): release one is a fully static app - no server, no database server, no accounts. The browser downloads the repository from the GitHub API, parses it with tree-sitter compiled to WASM in a Web Worker, stores the graph in IndexedDB, and calls the visitor's own model directly. The server stack below is the v2 plan.

- **Frontend:** React, Vite and Tailwind CSS. In v1 this is the whole app.
- **Data and auth:** v1: IndexedDB in the visitor's browser, no accounts. v2: self-hosted Supabase, PostgreSQL and pgvector.
- **Infrastructure:** v1: free static hosting only. v2: free-tier VM target, subject to available resources and measured capacity.
- **Indexing:** v1: in-browser worker, GitHub archive downloads, code filtering and tree-sitter (WASM) parsing. v2: a queued worker with shallow clones.
- **Retrieval:** symbol-aware chunks, embeddings and graph-assisted ranking - computed locally in v1.
- **Models:** caller-supplied Gemini credentials or a caller-controlled Ollama endpoint, called directly from the browser.

## Build order

- Prove the in-browser indexing and citation-chat pipeline on one small repository.
- Add the architecture map and source viewer.
- Improve retrieval, citation checks and model settings.
- Publish a tested demo with shareable maps.
- Add guided tours, impact views, incremental indexing, sharing and exports. These are part of release one (owner decisions, 2026-10-16), ordered in vertical slices in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
- v2 (owner decision, 2026-10-16, evening): everything that needs a server - the hosted MCP endpoint, the GitHub Action, accounts and multi-repo registry, hosted share previews, private repositories, and the Supabase backend itself.

Repository size caps, secret scanning and honest failure states are part of the product, not optional launch polish.

## Project documents

- [Roadmap](ROADMAP.md) - planned build order and releases.
- [Architecture](ARCHITECTURE.md) - source of truth for the system design.
- [Progress](PROGRESS.md) - dated log of what actually happened, plus the end goal.
- [Design](DESIGN.md) - UI and visual design rules.
- [Product requirements](PRD.md) - planned product scope, target user and features.
- [Technical requirements](TRD.md) - quick stack lookup; ARCHITECTURE.md owns the design.
- [App flow](APP_FLOW.md) - planned screens and core user journeys.
- [UI/UX brief](UI_UX_BRIEF.md) - quick-reference design brief with the color palette.
- [Backend schema](BACKEND_SCHEMA.md) - planned database schema sketch.
- [Implementation plan](IMPLEMENTATION_PLAN.md) - build phases with done criteria.

CodeAtlas takes inspiration from existing code-graph and repository tools while aiming to build its own interface and workflow. Covering their functions is the release-one scope, not a claim of current parity: nothing is built yet.

## Development

Phase 1 of the app (the browser spine: indexing pipeline, IndexedDB storage and the first module map) is built on the `instinct` branch; `main` holds documentation only until the owner merges.

Run locally:

```
git checkout instinct
bun install
bun run dev
```

`bun run build` type-checks and produces the production build.
