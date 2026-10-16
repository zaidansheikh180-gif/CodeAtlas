# CodeAtlas feature-pack plan

Status: Chosen (owner, 2026-10-17). Two owner feature packs - a 30-prompt set and a 32-item CodeGraph layer spec - de-duplicated into one build order of 62 items. The owner's instruction: build all of them, phased, with no per-phase approval gate; stop and ask only on true conflicts (the "Open questions" section below). Each phase lands buildable, tested and documented on the `instinct` branch before the next begins. Phase status lives in [PROGRESS.md](PROGRESS.md); the task-level plan is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Legend: BUILT = on `instinct` today. PARTIAL = exists, needs extension. NEW = not started.

## What exists today (phases 1-3)

- Ingestion: public GitHub URL, git tree + raw fetching with timeouts and retry, exclusions (vendored, binary, generated, oversized), secret scanning, staged progress UI, cancel, graceful named errors, full re-index, default branch only (no branch/tag/commit picker yet).
- Pipeline safety: worker watchdog with heartbeats, per-stage wall-clock backstops, and named stall/crash failures (phase 3).
- Graph: file and symbol nodes, imports/calls/contains edges (extracted and inferred), built in the worker, persisted in IndexedDB, stats in the header.
- Map: interactive module map with curved, clearance-routed edges (phase 3), selection, module file panel, source preview with syntax highlighting and line numbers.
- Graph Query Mode (phase 3): key-free structural questions (imports, dependents, callers, callees, impact, shortest path, explain, file structure) with ranked node resolution, deterministic answers, clickable file:line citations and map highlights; semantic questions get an honest needs-model-key answer. Covered by 34 unit tests.
- Privacy: secret scanning at index time; no keys anywhere yet.

## Phase 3 (DONE 2026-10-17): watchdog, curved edges, Graph Query Mode

Shipped and verified (see PROGRESS.md): worker watchdog; curved map edges verified on four repos; Graph Query Mode (pack-1 #4; spec-2 #6, and the traversal core for #7/#8/#9/#11).

## Phase 4: search, explorer, ingestion completion

- Repo-wide search: exact, case-insensitive, prefix, fuzzy and regex modes; ranked grouped results; keyboard navigation; runs in the worker with debounce. [pack-1 #6, spec-2 #4]
- Source viewer upgrades: symbol outline, breadcrumbs, in-file search, virtualization for large files, open-at-line from every entry point. [pack-1 #5, spec-2 #5]
- File and dependency explorer: tree view with sizes and dependency counts, synced with map and viewer, virtualized. [pack-1 #7, spec-2 #10]
- Ingestion completion: branch/tag/commit picker and incremental re-index (changed files only, by content hash). [pack-1 #1, spec-2 #1]
- Impact panel and call flows: dedicated impact view with affected-test detection and call-flow visualization, built on the phase-3 traversal core. [pack-1 #8, #9; spec-2 #7, #8, #9, #11]
- Map upgrades: edge-type styling, edge filters, expand/collapse modules, minimap. [spec-2 #3]

## Phase 5: graph tooling

- Clustering: DONE (2026-10-17) - deterministic greedy modularity in the search worker, community stats, map toggle with dominant-community recolor and inspect-to-dim. [pack-1 #11, spec-2 #12]
- Community labeling: DONE (2026-10-17) - deterministic placeholders, manual rename persisted in localStorage per repo; model-generated labels remain an optional later layer, to be marked AI-generated. [pack-1 #12, spec-2 #13]
- Diagnostics dashboard: DONE (2026-10-17) - eight deterministic checks in the worker, dashboard with severity/type filters, JSON/Markdown export, read-only suggestions. [pack-1 #17, spec-2 #21]
- Graph export/import as JSON, plus Mermaid and SVG where practical. [pack-1 #18, spec-2 #22]

## Phase 6: versions and multi-repo

- Repository snapshots and version comparison with a visual diff. [pack-1 #19, spec-2 #23]
- Multi-repository global graph: namespaced nodes, per-repo filtering, cross-repo paths. [pack-1 #15, spec-2 #19]
- Graph merge and compare. [pack-1 #16, spec-2 #20]

## Phase 7: model-assisted layer (visitor's own key, optional, static-only)

- Privacy and key management first: memory-only keys, privacy notice, sensitive-file globs, privacy report, one-click wipe. [pack-1 #23, spec-2 #26]
- Semantic extraction with an optional key: INFERRED vs EXTRACTED edges, batching, progress, cancel. [pack-1 #10, spec-2 #14]
- Model chat with retrieval: graph-first retrieval, context budgets, clickable citations, streaming, cancel. [pack-1 #21, spec-2 #15]
- Prompt and token budget controls. [pack-1 #22, spec-2 #16]
- Settings page. [pack-1 #26, spec-2 #27]
- Feedback memory and lessons/reflections, local and LLM-free by default. [pack-1 #13, #14; spec-2 #17, #18]

## Phase 8: local watch mode

- File System Access API folder indexing, watching and incremental updates. [pack-1 #20, spec-2 #24]

## Phase 9: polish and infra

- Error handling and observability: central error model, diagnostics panel, redacted export. [pack-1 #27, spec-2 #28]
- Performance mode for large repos: virtualization, progressive rendering, metrics. [pack-1 #28, spec-2 #29]
- Accessibility pass. [pack-1 #29, spec-2 #30]
- Onboarding tour. [pack-1 #25, spec-2 #31]
- Documentation sweep including CONTRIBUTING and SECURITY. [pack-1 #30, spec-2 #32]

## Open questions for the owner (ask when the phase arrives; do not build silently)

1. MCP-style agent access (spec-2 #25): needs a local server (MCP runs over stdio/SSE), which conflicts with static-only v1. Alternatives to offer: an in-page agent bridge (URL commands/postMessage), an optional companion CLI the owner runs himself, or defer to v2.
2. Private-repository tokens (pack-1 #1, spec-2 #1): technically fine as memory-only client-side tokens, but it is credential handling - confirm the UX (memory-only, never persisted) before building.
3. Graphify-compatible import (pack-1 #24): needs a real Graphify file sample to match the format; ask for a sample or defer.
4. PDF/image semantic extraction (part of spec-2 #14): heavy (PDF parsing plus vision models); propose deferring.

## Engineering notes

- tree-sitter WASM is already in use for parsing; no new conflict there.
- Multi-provider model keys stay static-friendly: direct browser-to-provider calls with the visitor's key; CORS support varies by provider and must be verified per provider in phase 7.
- Everything above stays client-side; IndexedDB remains the only store. No backend is introduced by this plan.
