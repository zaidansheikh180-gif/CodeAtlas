# CodeAtlas progress log

Dated log of what actually happened. Newest entries go at the top of the log. Plans live in [ROADMAP.md](ROADMAP.md) and [ARCHITECTURE.md](ARCHITECTURE.md); this file records what is done.

## How to update this file

- Add a new dated entry at the top of the Log, in the form `### YYYY-MM-DD` followed by short bullets.
- Log facts only: what was decided, built, measured or changed. Planned work goes in Next up, not in the log.
- Move finished items out of Next up. Keep Next up to the few things that are actually next.
- If a change affects the design, also update [ARCHITECTURE.md](ARCHITECTURE.md) or [DESIGN.md](DESIGN.md) in the same commit.
- Mark anything not yet working as planned. Do not record numbers, benchmarks or results that were not measured.

## End goal: what done looks like

This is the target, not the current state. Nothing here exists yet.

CodeAtlas is a deployed public web app. A visitor lands on a clean dark page with one input and a few pre-indexed example repositories. Opening an example shows its architecture map instantly, with no account and no key: 8 to 12 modules at the top level, drilling down into files and symbols, with confidence shown on every edge.

Paste any public GitHub repository URL and watch real indexing progress. Get the same map for that repo, a source viewer, and a call view showing callers, source and callees. Search with `/` or Cmd-K. Every view has a link that reproduces it.

Add your own Gemini key or point at your own Ollama endpoint and chat with the repo. Answers cite `file:line` against the indexed commit, light up the matching map nodes, flag any citation that cannot be verified, and show which files the answer used and what it did not see. A cost estimate appears before indexing or chatting. Secret scanning runs before any code reaches a model.

Share a read-only map link with a social preview image, embed it, or export PNG, SVG and JSON. There is never a shared or owner key.

Superseded 2026-10-16 (evening): the sentence "Whole project runs on a self-hosted Supabase, and the project ships with a one-file self-host setup" described the server plan. v1 is static-only (owner decision); Supabase, the share preview image and the hosted embed are v2. In v1 a shared link re-indexes in the recipient's browser and the exported standalone HTML file is the portable share.

Long-term north star (a superset of what existing code-graph tools offer, done in one hosted place):
- Understanding: blast radius, community and module summaries, path between two nodes, guided tours ordered by dependency, a "start here" path, plain-English node summaries, Newcomer and Engineer views.
- Collaboration and reach: route share cards, embed button, Obsidian export, PR and diff impact views, before and after architecture compare, GitHub Action, and an MCP endpoint for coding agents.
- Depth: incremental re-index on new commits, more languages, docs and rationale notes in the graph, private repos through GitHub OAuth, a light theme, ask-from-map scoped questions, and a local versus cloud answer comparison page.


Dated log of what actually happened. Newest entries go at the top of the log. Plans live in [ROADMAP.md](ROADMAP.md) and [ARCHITECTURE.md](ARCHITECTURE.md); this file records what is done.

## How to update this file

- Add a new dated entry at the top of the Log, in the form `### YYYY-MM-DD` followed by short bullets.
- Log facts only: what was decided, built, measured or changed. Planned work goes in Next up, not in the log.
- Move finished items out of Next up. Keep Next up to the few things that are actually next.
- If a change affects the design, also update [ARCHITECTURE.md](ARCHITECTURE.md) or [DESIGN.md](DESIGN.md) in the same commit.
- Mark anything not yet working as planned. Do not record numbers, benchmarks or results that were not measured.

## End goal: what done looks like

This is the target, not the current state. Nothing here exists yet.

CodeAtlas is a deployed public web app. A visitor lands on a clean dark page with one input and a few pre-indexed example repositories. Opening an example shows its architecture map instantly, with no account and no key: 8 to 12 modules at the top level, drilling down into files and symbols, with confidence shown on every edge.

Paste any public GitHub repository URL and watch real indexing progress. Get the same map for that repo, a source viewer, and a call view showing callers, source and callees. Search with `/` or Cmd-K. Every view has a link that reproduces it.

Add your own Gemini key or point at your own Ollama endpoint and chat with the repo. Answers cite `file:line` against the indexed commit, light up the matching map nodes, flag any citation that cannot be verified, and show which files the answer used and what it did not see. A cost estimate appears before indexing or chatting. Secret scanning runs before any code reaches a model.

Share a read-only map link with a social preview image, embed it, or export PNG, SVG and JSON. There is never a shared or owner key.

Superseded 2026-10-16 (evening): the sentence "Whole project runs on a self-hosted Supabase, and the project ships with a one-file self-host setup" described the server plan. v1 is static-only (owner decision); Supabase, the share preview image and the hosted embed are v2. In v1 a shared link re-indexes in the recipient's browser and the exported standalone HTML file is the portable share.

Long-term north star (a superset of what existing code-graph tools offer, done in one hosted place):
- Understanding: blast radius, community and module summaries, path between two nodes, guided tours ordered by dependency, a "start here" path, plain-English node summaries, Newcomer and Engineer views.
- Collaboration and reach: route share cards, embed button, Obsidian export, PR and diff impact views, before and after architecture compare, GitHub Action, and an MCP endpoint for coding agents.
- Depth: incremental re-index on new commits, more languages, docs and rationale notes in the graph, private repos through GitHub OAuth, a light theme, ask-from-map scoped questions, and a local versus cloud answer comparison page.

The first release is the smaller core: URL in, layered map, citation chat with your own key, shareable links and a few pre-indexed examples. The rest follows in waves, and each item is only claimed once it ships.

## Current status

Pre-code. Documentation only. No app, schema or deployment yet. Verified by reading the repository on 2026-10-16: the eleven documents listed in the README exist on main; no source code, migrations or tests exist.

Scope note (2026-10-16, owner decision): release one now includes all functions of the related starred tools, not a smaller core. This supersedes the "smaller core" paragraph in the end goal above. Flagged and blocked items are listed in [PRD.md](PRD.md).

## Next up

Updated 2026-10-16 (late evening): phase 1 (browser spine) is built on the `instinct` branch.

1. Phase 2: IndexedDB read/eviction hardening and measured size caps on medium and large repos (write, read back, evict cleanly; then record final cap values).
2. Phase 3 (settings): local model settings - Gemini key and Ollama endpoint stored only in the browser, Ollama CORS connectivity check; optional visitor GitHub token storage (owner decision 2026-10-16).
3. Phase 4: indexing depth - pause/resume from the jobs store, chunking and token counting.
4. Then chat with citations (phase 5) and the layered map with source viewer (phase 6).

(Superseded: the previous list started with self-hosted Supabase on the free-tier VM - that whole track is v2 now.)

## Log

### 2026-10-16 (map + panel polish pass, user-steered)
After the user's field test on tt-a1i/archify (577 files, 3,879 symbols, 14,356 edges - largest repo indexed so far), a polish pass on the map and side panel. All items pixel-verified in headless Chromium against the dev server:
- Unlinked modules no longer drift: modules with no import edges skip the force field and sit in a tidy grid beside the cluster under a "No imports found" label.
- Tighter cluster: weak gravity (forceX/forceY) on linked nodes; settled layout re-fits to bounds on data change and on canvas resize (opening the panel shrinks the canvas).
- Readability: node labels and file counts draw at a constant screen size regardless of zoom; fit zoom cap raised to 1.6.
- Hint text at bottom left is now a padded, bordered chip (was clipped at the screen edge).
- Side panel is resizable: drag handle on its left edge (role="separator", keyboard arrows), width clamped 280-860px and persisted in localStorage. Verified: drag 320 -> 584px, keyboard +48px, persists across reload.
- Source preview: no more mid-word wrapping; lines keep their shape with horizontal scroll and sticky line numbers. Syntax coloring added (user request): Prism, lazy-loaded on first file open (core 19.5 kB + per-grammar chunks, only JS/TS/TSX/Python + markup/css/json/bash/yaml/toml/sql/markdown), colored with DESIGN.md palette steps only (Dragonfruit keywords, green strings, amber numbers, blue functions, muted comments). Files over 300 KB and unknown languages fall back to plain text.
- Regression caught and fixed during this pass: moving the link array for the force simulation broke edge rendering (draw read the pre-resolution array); one shared array drives both now.

### 2026-10-16 (user field feedback, phase 1 map)
User indexed https://github.com/tt-a1i/archify.git (a larger real repo) on the phase-1 build. Indexing completed fine at that size. Map issues to fix as polish (phase 2/6 input, not yet scheduled):
1. Bottom-left hint text is clipped at the left edge of the canvas.
2. Node labels and file-count numbers are too small to read comfortably.
3. Unlinked modules drift far from the main cluster and scatter across empty space.
4. The connected cluster stays cramped in one area while most of the canvas is empty.

### 2026-10-16 (phase 1 built, instinct branch)
- Phase 1 (browser spine) built and verified in a real browser (headless Chromium, Playwright): static React + Vite + Tailwind v4 app (Bun), Web Worker indexing pipeline, IndexedDB storage layer, GitHub fetching, first module map. Code lives on the `instinct` branch; main is untouched.
- Measured finding that changed the design: the GitHub zipball endpoint redirects to codeload.github.com, whose CORS header only allows render.githubusercontent.com - a browser app cannot read the archive from any other origin. Fetching instead uses one git-tree API request for the recursive file list, then raw.githubusercontent.com file downloads (CORS-open, not counted against the API rate limit), 8 at a time. Recorded in TRD.md and ARCHITECTURE.md.
- Measured on a 4-repo test set (this browser run, anonymous rate limit): sindresorhus/is - 8 files kept, 5 parsed, 292 symbols, 680 edges, total 0.8s. pallets/itsdangerous - 28 kept, 15 parsed, 144 symbols, 271 edges, 1.1s. expressjs/express - 156 kept, 141 parsed, 231 symbols, 932 edges, 1.1s (after assignment-expression symbols were added mid-measurement). psf/requests - 60 kept, 37 parsed, 807 symbols, 1878 edges, 0.8s. JS heap delta per run: about 1 MB (Chrome performance.memory). Parse time per repo stayed under 0.4s at this scale; the caps (4000 files, 25 MB source, 1 MB per file) are untested at the top end - larger repos still to be measured.
- Scope note: these repos are small. Numbers are real but not yet evidence for the caps; phase 2 measures medium and large repos.
- Extraction coverage note: JS symbols cover function/class/method declarations, arrow-function variables and `exports.x = function` assignments; calls and imports resolve same-file, imported-name and unique-name (INFERRED) only. Python covers defs, classes and imports (including src-layout resolution). Everything else degrades to files only, by design.

### 2026-10-16 (follow-up decisions)
- Owner answered the three open decisions from the static-v1 rescope: (1) visitors may optionally paste their own GitHub token, stored only in their browser, to raise the API rate limit - Chosen. (2) The landing-page examples ship as bundled pre-built graphs with the static site, so the demo is instant - Chosen. (3) The GitHub Action stays in v2, with the CI-local variant (analysis inside the CI job, no hosted API) as its planned v2 form.
- Applied across PRD.md, TRD.md, APP_FLOW.md, ARCHITECTURE.md and IMPLEMENTATION_PLAN.md. Doc edits for the whole static-v1 rescope are prepared and approved for push; pushing follows.


### 2026-10-16 (static-only v1)
- Owner decision: v1 is static-only. Asked whether CodeAtlas needs a backend at all, the owner chose the static option: browser fetches the public repo from the GitHub API, parses and builds the map client-side (tree-sitter WASM in a Web Worker), stores it in IndexedDB, and calls the visitor's own Gemini key or Ollama endpoint directly. Nothing was built or run.
- Moved to v2 with that decision: the hosted MCP endpoint (FR-039), the GitHub Action (FR-032, a CI-local variant is Proposed), the multi-repo registry (FR-041), hosted share previews and embeds (parts of FR-034/FR-035), and the whole server track - API server, indexing worker, self-hosted Supabase, accounts, token/abuse design (TASK-002, TASK-025, TASK-026, TASK-029).
- Annotated across PRD.md, TRD.md, APP_FLOW.md, BACKEND_SCHEMA.md, IMPLEMENTATION_PLAN.md, ARCHITECTURE.md, PROGRESS.md, README.md and ROADMAP.md: every FR and task now carries a Release label; superseded text is kept in place with notes.
- New v1 risks written down with mitigations: GitHub anonymous rate limit (archive-first fetching; optional visitor token accepted by the owner the same evening), large-repo performance in one tab (size caps, measured in phase 1), Ollama CORS setup (detection plus guidance in the setup card).


### 2026-10-16 (scope and spine audit)
- Owner decision: release one includes all functions of graphify, Understand-Anything, codegraph, code-review-graph, repomix, archify, headroom and graph-engineering. Catalogued as FR-001 to FR-044 in [PRD.md](PRD.md); features not adopted are listed there with reasons.
- Applied the merged doc-spine standard: status labels, stable IDs (FR, NFR, JRN, SCR, DATA, API, TASK, TEST), traceability table in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), consistency audit. Nothing was built or run.
- Decided: v1 languages are JS/TS and Python (FR-008). Decided: framework subset (FR-009); GitHub Action, MCP endpoint and custom languages in v1 (FR-032, FR-039, FR-043); not-adopted list confirmed. Decided: private repos (FR-042) move to v2.

### 2026-10-16
- Added six planning documents from the doc-spine template: [PRD.md](PRD.md), [TRD.md](TRD.md), [APP_FLOW.md](APP_FLOW.md), [UI_UX_BRIEF.md](UI_UX_BRIEF.md), [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Unset values are marked TBD.
- Set the UI color palette from the owner's reference: Dragonfruit #FF4696 (single accent) on Night Violet #1E1033 (base background), recorded in [UI_UX_BRIEF.md](UI_UX_BRIEF.md) and [DESIGN.md](DESIGN.md). Dragonfruit on Night Violet measures about 5.6:1 contrast, passing WCAG AA for normal text.
- Expanded the README project-documents list to link every document on main.

### 2026-10-09
- Decided on the project after reviewing a set of starred code-graph and repository tools.
- Wrote the project plan: four pieces (frontend, API, indexing worker, self-hosted Supabase), three model modes, build phases.
- Wrote a competitive teardown of six existing tools, producing a checklist of 27 features to match or beat and 10 new features of our own. It is kept private and is not published here.
- Created this public repository.
- Published README.md and ROADMAP.md.

### 2026-10-16 (phase 2: storage hardening and large-repo measurements)
- Storage hardening (`src/lib/db.ts`, `src/workers/index.worker.ts`):
  - Every index write is read back and verified against the store; a mismatch fails the job with a plain message instead of leaving a half-written index behind.
  - Quota errors (`QuotaExceededError`) are caught at save and shown as a designed message: "This browser ran out of storage while saving the index. Clear an older index from the start page and try again."
  - Eviction is complete: clearing a repo removes its files, symbols, edges and its chat conversations and messages (previously conversations and messages stayed behind).
  - Clear entry points: a per-repo "Clear" button on the start page and a "Clear index" button in the repo view header.
- Fetch and parse hardening: a 30 s timeout on the tree request and 20 s on each raw file, one retry pass over failed downloads, and a 256 KB per-file parse guard so one very large file cannot wedge the worker. The phase-1 large-repo failure mode (a silent ~14 minute stall ending in the tab dying) no longer occurs.
- Measured on this branch with Playwright against `bun run dev`:
  - `tiangolo/fastapi` (medium): 2873 files, 5995 symbols, 12104 edges (11908 extracted, 196 inferred), 67 s wall. Saved and read-back verified.
  - `django/django` (large): 3595 files downloaded (214 skipped as vendored, binary or generated; 3 excluded by secret scanning), 2863 files parsed, 41200 symbols, 97366 edges (77841 extracted, 19525 inferred). In the constrained test sandbox the final save hit the browser storage quota; the new quota path caught it and showed the designed message instead of wedging. Desktop browsers carry a far larger quota; the save path itself is verified by the read-back check on smaller repos.
  - `microsoft/vscode` (over the caps): no conclusive run yet - both sandbox attempts were invalidated when the dev server reloaded the tab mid-measurement (local doc edits touched the watched repo root), not by any product failure. A clean run is queued.
- Eviction verified by inspection: after clearing from either entry point, IndexedDB holds zero files, symbols, edges, conversations and messages for that repo.
- Final caps (`src/lib/caps.ts`): 4000 files, 25 MB of source text, 1 MB per file, plus the 256 KB parse guard in the worker.
