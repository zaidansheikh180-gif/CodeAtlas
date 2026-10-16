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
### 2026-10-17 (phase 3, part 1: worker watchdog and curved map edges)
- Worker watchdog (`src/lib/pipeline.ts`, `src/workers/index.worker.ts`, `src/App.tsx`):
  - The worker posts a heartbeat every 2 s carrying the stage it is in; the page treats any worker message as proof of life.
  - 15 s of silence cancels the run with a named failure ("Indexing stalled during \"parse code\" - the worker stopped responding, so this run was cancelled"); per-stage wall-clock backstops (fetch 5 min, filter 1 min, secrets 2 min, parse 10 min, graph 5 min, store 5 min); a worker crash or an unreadable message fails the run with a named message; the page marks the job failed in IndexedDB because a dead worker cannot.
  - Dev-only fault injection `?hang=<stage>` wedges the worker's event loop so the stall path can be exercised end to end.
  - Verified with Playwright against `bun run dev`: a run wedged at the parse stage surfaced the named stall failure after 18.1 s; a healthy run (`sindresorhus/is`) indexed end to end in 1.8 s. This closes the phase-2 django failure mode (silent stall, UI waiting forever).
- Curved map edges (`src/components/MapCanvas.tsx`): module-map edges are now quadratic arcs instead of straight lines. Every arc bends to the right of its travel direction, so two-way pairs (A to B and B to A) fan out as two separate curves; the bend side and size are chosen per edge to keep arcs clear of every other node; endpoints trim to the node circles and arrowheads land on the node edge, aligned with the arc's arrival tangent. Edge thickness by import count and the DESIGN palette are unchanged. Verified by screenshot inspection on `sindresorhus/is`, `tiangolo/fastapi` and `expressjs/express`.
### 2026-10-17 (phase 3, part 2: Graph Query Mode)
- Query engine (`src/lib/graphquery.ts`): plain-English structural questions become deterministic graph answers with file:line citations - no model key needed. Covered intents: what X imports, who imports X, who calls X, what X calls, the impact of changing X (direct vs transitive dependents), the shortest path between two nodes, explain a node, and the project file structure. Anything else gets an honest "needs a model key" answer that points at the later chat phase.
- Node resolution: exact path or name beats case-insensitive, partial path, prefix, contains, then fuzzy subsequence; files outrank symbols on name ties; an ambiguity note appears only when the top scores are genuinely close. Path matching applies to files only - a symbol's path is its file's path, so same-file symbols no longer flood the resolver as false "exact path" matches (regression-tested).
- Traversal: breadth-first with a visited set so import cycles terminate; depth 1 for direct import/call neighbours; impact walks dependents to depth 3 and splits direct from transitive; shortest path uses undirected BFS; relation filters separate import from call edges.
- UI (`src/components/RepoView.tsx`, `src/components/MapCanvas.tsx`): a query bar above the map; the answer card shows a one-line summary plus clickable citations that open the file preview scrolled to the cited line; modules an answer touches get a dragonfruit ring on the map.
- Unit tests (`src/lib/graphquery.test.ts`, 34 tests, run with `bun test`; test files are excluded from the app build typecheck): resolver rankings, intent detection, target extraction, both BFS directions, depth and cycle termination, relation filters, the impact split, shortest path, citations and the needs-model fallback.
- Verified end to end with Playwright against `bun run dev` on `expressjs/express` (156 files, 231 symbols, 932 edges):
  - "What does lib/application.js import?" - lib/view.js and lib/utils.js, cited.
  - "What is affected if I change lib/utils.js?" - 7 direct and 4 transitive dependents; all four modules ringed on the map.
  - "Who calls compileQueryParser?" - 1 direct caller (app setup in lib/application.js:351-383).
  - "What is the shortest path from lib/express.js to lib/response.js?" - 1 hop.
  - A semantic question ("Why is this codebase so elegant?") - the designed needs-model-key answer.
  - Clicking a citation opens the cited file scrolled to the cited line.
### 2026-10-17 (phase 4, part 1: repository-wide search)
- Search engine (`src/lib/search.ts`): exact, case-insensitive, prefix, fuzzy (subsequence) and /regex/ modes over file names, paths, symbols and indexed code content. Ranking tiers follow the feature-pack spec: exact name, path, symbol definition, code content, fuzzy. Results group into Files, Symbols, Code matches and Graph nodes (map modules); every result carries path and line; per-group caps keep one repetitive file from flooding the list.
- Search worker (`src/workers/search.worker.ts`): loads the repo's files and symbols from IndexedDB once and answers queries off the main thread, so large repositories stay responsive; stale responses are dropped by sequence id.
- Palette UI (`src/components/SearchPalette.tsx`): Ctrl/Cmd+K or the header Search button opens it; 150 ms debounce; arrow keys move, Enter opens, Esc closes; empty-query hint, no-results and invalid-regex states are plain messages. Clicking a file, symbol or code result opens the source preview at the exact line; clicking a graph-node result selects that module on the map.
- Unit tests (`src/lib/search.test.ts`, 13 tests): tier ordering, group order, all five modes, content line numbers, per-group caps, invalid regex, empty queries.
- Verified end to end with Playwright against `bun run dev` on `expressjs/express`: "response.js" ranked lib/response.js first; "compileETag" grouped the symbol definition (lib/utils.js:130) above six code matches with line numbers; "/[/" showed a clean invalid-regex message; "lib" listed the lib module under Graph nodes and clicking it opened the module on the map; Enter opened lib/response.js in the preview at line 1. Five pixel-inspected screenshots in the phase report.
### 2026-10-17 (phase 4, part 2a: source viewer upgrades)
- Breadcrumbs with ref info: the preview header shows the path as segments plus the indexed commit (`lib / application.js @ a419aa7`).
- Symbol outline: an Outline toggle lists the open file's symbols (kind, name, line); clicking one scrolls to its definition. An Imports section lists the file's resolved local imports; clicking one opens that file - import navigation without parsing code in the viewer.
- In-file search: a Find box (Ctrl/Cmd+F while a file is open) counts line matches and Enter jumps to the first; the cited-line highlight and scroll reuse the phase-3 citation path.
- Verified end to end with Playwright on `expressjs/express`: outline listed application.js's methods with lines; clicking the outline's lib/view.js import opened view.js; "router" in view.js honestly showed 0 matches. Two pixel-inspected screenshots in the phase report.
- Remaining in this item: line-range highlighting (single-line scroll-to exists) and virtualization for very large files.
### 2026-10-17 (phase 4, part 2b: file and dependency explorer)
- Explorer panel (`src/components/FileExplorer.tsx`, data layer `src/lib/explore.ts`): the repository tree with folder file-counts, file sizes and per-file dependency-count badges (imports out + in). Folders expand/collapse; a filter box switches to a flat filtered list; sorting by name, size or dependency count. Rows render in a virtualized window (fixed row height plus overscan), so large repositories stay smooth. Toggled from the header; hidden on small screens (the map and panel take precedence there).
- Sync: clicking a file opens it in the source viewer (and its module on the map); opening a file or selecting a module elsewhere expands and scrolls the tree to it; the open file's row stays highlighted.
- Per-file dependencies in the viewer outline: Imports (resolved local targets), Imported by (dependents), Calls (symbols this file calls, with file:line) and External packages (non-relative require/import specifiers). Clicking any file or symbol dependency navigates to it.
- Unit tests (`src/lib/explore.test.ts`, 7 tests): dependency counting, tree nesting and folder stats, all three sort modes, expand/collapse flattening, size formatting.
- Verified end to end with Playwright on `expressjs/express`: tree showed module folders with counts and dep badges (utils.js badge 7); clicking through the tree opened files in the viewer; lib/utils.js's outline listed 8 symbols, 7 dependents and its calls; the filter narrowed to router files. Three pixel-inspected screenshots in the phase report.
- Spec notes: "last modified" sort is not available (the index stores no mtimes); external symbols used are represented by the External packages list plus inferred call edges.
### 2026-10-17 (phase 4, part 3a: branch, tag and commit picker)
- Ref picker on the landing confirm card (`src/components/Landing.tsx`, `listRefs` in `src/lib/github.ts`): after the URL check, CodeAtlas lists the repository's branches (default marked) and tags in a select, with "A commit or other ref…" opening a free-text input for a commit SHA or unlisted ref. Changing the pick re-resolves the commit live (resolved sha shown under the picker); the Start button waits for resolution. If the branch list call fails (rate limit), the picker falls back to the default branch plus free-text refs and says so. URLs that already carry a ref (/tree/<branch>, /commit/<sha>, /releases/tag/<tag>) still work and preselect that ref.
- The chosen ref is stored on the index record (`RepoRec.ref`, optional so older indexes stay valid) and shown in the repo header (non-default refs) and in the landing recent-list rows.
- Verified end to end with Playwright on expressjs/express: 116 branches+tags listed across Branches/Tags/Other groups; picking tag v5.3.0 re-resolved from a419aa7 to cf6722b; custom mode showed the commit input. Three pixel-inspected screenshots in the phase report.
### 2026-10-17 (phase 4, part 3b: incremental re-index)
- Re-index button in the repo header (`src/components/RepoView.tsx`): resolves the picked ref's latest commit. Same sha reports "Up to date" inline; a newer sha starts an indexing run. Rate-limit and network failures show an inline error, not a crash.
- Incremental updates (`src/lib/incremental.ts`, worker changes in `src/workers/index.worker.ts`): the stored FileRec.contentHash is the git blob sha from the tree, so a re-index diffs the fresh tree against the stored index and only downloads new or changed files - unchanged files are reused from IndexedDB with zero network. Removed-upstream files are counted and dropped because the new index is written fresh under the new commit's repoId, after which the old index's records are deleted. When the re-index lands on the same repoId (same commit re-run), reuse still applies and the old records are kept (they are overwritten by the new write). Parse, graph and storage stages run over the merged set, so symbols and edges are always built from complete current data.
- Unit tests (`src/lib/incremental.test.ts`, 5 tests): identical trees reuse everything, changed/new download and untouched reuse, removed-upstream counting, empty storage falls back to full download, empty sha never matches.
- Verified end to end with Playwright on sindresorhus/is: fresh index, then a re-index showed "0 changed or new file(s) downloaded, 8 reused unchanged from the previous index"; the stored graph after the re-index was byte-identical in shape to the fresh one (679 extracted / 1 inferred edges, checked in IndexedDB directly); the landing list kept exactly one entry; a second Re-index click reported "Up to date". Two pixel-inspected screenshots in the phase report. Sandbox note: a same-session express re-index hit the browser's small IndexedDB quota at the save stage (the designed graceful error) - the large-repo full-save path is unchanged from a first-time index and could not be measured in this environment.
### 2026-10-17 (phase 4, part 4a: impact analysis and affected tests)
- Impact panel (`src/components/ImpactPanel.tsx`, graph math in `src/lib/impact.ts`): reverse traversal from any selected file or symbol. Open it from the Impact button in the file header or the bolt beside each outline symbol. Direct and transitive dependents are listed separately, each with its node type, depth, file:line citation (click to open) and the surviving dependency path (utils.js -imports-> application.js). Depth is configurable (1-5), results filter by relationship type (defines/imports/calls), cycles terminate via a visited set, and long results truncate at 200 nodes with a note.
- Export: the report downloads as Markdown (table with citations and depths) or JSON.
- Highlight on map: a checkbox tints every module containing an affected file on the architecture map.
- Affected tests: for a file target, likely affected test files are detected two ways - confirmed (the test imports the changed file, directly or through up to two intermediates) and heuristic (same file name or mirrored directory), each labelled with its reason. When the test runner is detectable from the test files' imports (vitest, node:test, jest, mocha), a button copies a suggested test command.
- Unit tests (`src/lib/impact.test.ts`, 11 tests): direct/transitive split with paths, depth limit, cycle termination, node-type filter, unknown target, Markdown rendering, confirmed vs heuristic test detection without double counting, test-path patterns, runner detection.
- Verified end to end with Playwright on expressjs/express: lib/utils.js showed 7 direct and 4 transitive dependents, 6 affected tests (5 confirmed import relationships plus 1 heuristic, mocha detected as the runner); the symbol normalizeType showed 3 direct and 19 transitive dependents with call/define paths; map highlighting ringed the affected modules. Three pixel-inspected screenshots in the phase report.
### 2026-10-17 (phase 4, part 4b: call-flow visualization)
- Call-flow model (`src/lib/callflow.ts`): breadth-first over calls edges in both directions from any symbol, building a layered directed graph - callers at negative layers, callees positive, root zero. A shared visited set makes recursion and diamond shapes terminate (recursion keeps a single self-loop edge); depth is configurable (1-6, UI offers 1-4) and results cap at 80 nodes with a truncated note. Nodes skipped at the cap are visited-but-unplaced, so back-edges to them are dropped: every emitted edge has both endpoints in the flow (a missing-endpoint edge crashed the first browser run on express - fixed in the model and covered by a test).
- Mermaid export (`toMermaid`): flowchart LR with sanitized ids and file:line labels, downloaded as a .mmd file.
- Call-flow panel (`src/components/CallFlowPanel.tsx`): opened from the call-flow button beside each symbol in the viewer outline. SVG layered layout - callers left, root centered in dragonfruit pink, callees right; each node shows the symbol name and its signature (the trimmed source line at the definition, falling back to file:line). Clicking a node recenters the flow on it; double-click opens the file at the definition. Depth select, callers/callees toggles, Highlight on map (tints every module containing a flow file), Export Mermaid. The panel auto-scrolls so the root stays visible in wide flows.
- Unit tests (`src/lib/callflow.test.ts`, 8 tests): layer signs, edge direction, recursion self-loop, depth limit, direction toggles, unknown root, capped back-edge drop, Mermaid rendering.
- Verified end to end with Playwright on expressjs/express: send showed 80 nodes / 85 calls with the truncation note, test files as callers on the left and callees on the right; clicking a node recentered on fn3 (8 nodes / 7 calls) with signatures shown. Two pixel-inspected screenshots in the phase report.
### 2026-10-17 (phase 4, part 5: map upgrades - edge types, filters, minimap)
- Edge types on the map (`src/lib/modules.ts`): module edges now aggregate calls as well as imports, keeping the relationship kind on every edge. Symbol-level calls resolve through their file to the module pair; intra-module edges stay dropped. Imports alone still drive the force layout, so the settled import structure never moves when call overlays toggle.
- Edge-type styling (`src/components/MapCanvas.tsx`): imports render as the existing solid arcs; calls render as dashed dragonfruit arcs at half the width growth and a lower cap, so the overlay never shouts over the structure. The type reads from the line style, not color alone (spec accessibility rule).
- Map toolbar (`src/components/RepoView.tsx`): a Map box on the canvas toggles imports and calls independently, with the line-style legend inline. The map caption now says which arrow style means what.
- Minimap: a corner overview renders the whole world (nodes as module-colored dots) with the current viewport framed; clicking it centers the main view on that world point.
- Unit tests (`src/lib/modules.test.ts`, 4 tests): per-kind aggregation with counts, symbol-to-module call resolution, intra-module drops for both kinds, unrelated edge types excluded. 82/82 green.
- Verified end to end with Playwright on expressjs/express: default view showed solid imports plus dashed calls (test->lib, lib<->examples, test<->examples); the imports toggle left only the solid import structure; the calls toggle left only the dashed overlay; a minimap click jumped the main view. Four pixel-inspected screenshots in the phase report.
- Remaining map items for a later part: expanding/collapsing directories into file-level nodes, and node/language/directory filters (meaningful once the map shows file-level nodes; module selection and search focusing already exist).
