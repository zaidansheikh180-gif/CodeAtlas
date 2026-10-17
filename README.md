# CodeAtlas

Understand a codebase before you change it.

CodeAtlas is a static web app that turns a public GitHub repository (or a local folder) into an interactive architecture map. Explore files, symbols and dependencies, ask key-free structural questions with answers grounded in the actual code, and follow every answer back to clickable `file:line` citations. Everything runs in your browser: no server, no accounts, nothing uploaded.

**Status: v1 feature-complete on the `instinct` branch.** Indexing, the knowledge graph, the map, search, graph queries, impact analysis, call flows, communities, diagnostics, snapshots, multi-repo views, local watch mode, exports, accessibility and onboarding are all built and tested (see [PROGRESS.md](PROGRESS.md)). The one remaining planned piece is the optional model-key layer (semantic extraction and model chat); its privacy design is documented below and in [SECURITY.md](SECURITY.md). `main` holds documentation only until the owner merges.

## Features

- **Repository ingestion:** paste a public GitHub URL, pick a branch, tag or commit, and watch staged progress as a Web Worker downloads, filters and parses the repo. Secret scanning at index time, vendored/binary/generated-file exclusions, cancel and resume, and incremental re-index of changed files only.
- **Local folder mode:** open a folder from your device with the File System Access API. Optional watch mode re-scans in the background and applies incremental updates as files change. Local files never leave the device.
- **Knowledge graph:** file, symbol and module nodes with `imports`, `calls` and `contains` edges, each tagged EXTRACTED (statically parsed) or INFERRED (heuristic), built by tree-sitter (WASM) in a worker and persisted in IndexedDB.
- **Architecture map:** a readable layered module map with curved clearance-routed edges, edge-type styling and filters, expand/collapse, minimap, keyboard navigation and a screen-reader alternative.
- **Key-free graph queries:** ask structural questions in plain words - imports, dependents, callers, callees, impact, shortest path, explain, file structure - and get deterministic answers with ranked node resolution, clickable citations and map highlights. No model key needed.
- **Search and source viewer:** repo-wide exact/prefix/fuzzy/regex search in the worker; source viewer with syntax highlighting, symbol outline, breadcrumbs, in-file search and open-at-line from every entry point.
- **Impact analysis and call flows:** see what a change to a file or symbol affects, including likely affected tests, and visualize call flows as diagrams with Mermaid export.
- **Communities and diagnostics:** deterministic clustering with renameable communities, plus a diagnostics dashboard running eight structural checks with JSON/Markdown export.
- **Snapshots, compare and merge:** save snapshots, diff two versions on a union-graph map, merge repositories with duplicate strategies, and explore a multi-repo global graph.
- **Export and import:** full-fidelity graph JSON export/import, plus Mermaid, GraphML and PNG map exports.
- **Feedback memory:** rate answers, attach corrections, and let ranking learn locally; export or import feedback as JSON.
- **Privacy by construction:** indexing and queries are local; secret scanning runs at index time; no keys are stored anywhere in v1.

## Quick start

```
git checkout instinct
bun install
bun run dev    # http://localhost:5173
```

Run the tests and a production build:

```
bun test
bun run build
```

## Using CodeAtlas

**Index a repository.** Paste a public GitHub URL on the landing page (optionally pick a branch, tag or commit), or open a local folder. Follow the staged progress; you can cancel and resume.

**Ask graph questions.** Open the query box and ask things like "what imports parser.ts", "who calls buildGraph", "impact of changing db.ts" or "shortest path from App to pipeline". Answers are deterministic, cite `file:line`, and highlight the relevant nodes on the map. Semantic (meaning-level) questions get an honest answer that they need the optional model layer.

**Read the map.** Pan with drag or arrow keys, zoom with the wheel or +/- keys, press 0 to refit. Select a module for its files, filter edges by type, expand modules into files, and open source at a line from any citation, search result or panel.

**Inspect citations.** Every answer and panel links back to the indexed commit, file and line range. A valid line reference is not proof an explanation is correct; uncertain (INFERRED) relationships stay visibly marked.

**Run impact analysis.** From a file or symbol, open the impact view to see direct and transitive dependents and likely affected tests, then open the call-flow view for a diagram of how execution reaches it.

**Snapshots and versions.** Save a snapshot before a big pull, re-index, and compare the two on a diff map with status-colored nodes and edges.

**Local watch mode.** Open a local folder, enable watching, and edit as usual; CodeAtlas quietly re-scans and updates the graph. Pause or stop anytime from the watch panel.

For query syntax, the graph schema, export formats, language support and performance tips, see [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Privacy model

- Indexing, parsing, querying and rendering all happen in your browser. IndexedDB is the only store.
- GitHub-mode indexing downloads repository files over the GitHub API; local-folder mode never touches the network for file contents.
- Secret scanning runs at index time; matched files are excluded and counted.
- No API keys are stored or required for any built feature. The planned model layer will use memory-only keys you supply, sent only to the provider you choose, only when you ask. Details in [SECURITY.md](SECURITY.md).

## Browser requirements

- A current Chromium-based browser (Chrome, Edge, Arc) for the full experience; local-folder mode and watch mode need the File System Access API, which is Chromium-only.
- GitHub-URL indexing, the map, search and queries work in current Firefox and Safari too.
- Web Worker, WASM and IndexedDB support required (all current browsers).

## Limitations

- JavaScript/TypeScript and Python get full symbol-level parsing; other languages appear as files and modules only, and are labelled as such.
- Public GitHub repositories only in v1; private repos are a v2 (server) item by owner decision.
- Very large repositories hit documented caps on files, symbols and edges; answers say when results were truncated.
- There is no backend: closing the tab loses nothing (IndexedDB persists), but there are no accounts, sync or hosted sharing.

## Troubleshooting

- **Indexing stalls or fails:** the worker watchdog names the stalled stage; retry from the error card. Persistent failures on huge repos usually mean the size caps - try a smaller ref or a local folder.
- **GitHub rate limits:** unauthenticated API access is limited per hour per IP. Wait for the window to reset, or index the same code as a local folder.
- **Watch mode stopped updating:** browser permission for the folder may have been parked; re-grant from the watch panel.
- **Something looks wrong:** open Status and diagnostics from the landing page for the error log, storage usage and a redacted export you can attach to a bug report.

## Optional model features (planned)

The remaining v1 candidate is an optional layer using your own model key: semantic edge extraction (INFERRED relationships beyond static parsing) and model-assisted chat with graph-first retrieval, token budgets and required citations. Planned providers: Gemini, OpenAI, Anthropic, DeepSeek, Kimi and Ollama, called directly from the browser with a memory-only key. The key-free graph remains fully functional without it. Status and the decision log live in [FEATURE_PACK_PLAN.md](FEATURE_PACK_PLAN.md).

## Project documents

- [User guide](docs/USER_GUIDE.md) - query syntax, graph schema, exports, watch mode, performance.
- [Architecture](ARCHITECTURE.md) - source of truth for the system design.
- [Progress](PROGRESS.md) - dated log of what actually shipped.
- [Feature pack plan](FEATURE_PACK_PLAN.md) - the phased build order and per-item status.
- [Contributing](CONTRIBUTING.md) - project structure, commands, tests, PR checklist.
- [Security](SECURITY.md) - key handling, data policy, exclusions, reporting.
- [Design](DESIGN.md) - UI and visual design rules.
- [Product requirements](PRD.md), [Technical requirements](TRD.md), [App flow](APP_FLOW.md), [UI/UX brief](UI_UX_BRIEF.md), [Roadmap](ROADMAP.md), [Backend schema](BACKEND_SCHEMA.md), [Implementation plan](IMPLEMENTATION_PLAN.md).

CodeAtlas takes inspiration from existing code-graph and repository tools while building its own interface and workflow.
