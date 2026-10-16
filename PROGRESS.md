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

Updated 2026-10-16 (evening) for the static-only v1. Phase 1, the browser spine:

1. Static app skeleton with the Web Worker parsing pipeline and the IndexedDB storage layer; measure parse time and memory on the test repo set.
2. In-browser indexing of one small public repo: archive fetch, filter, secret scan, tree-sitter (WASM) parse, graph build, per-stage progress.
3. Chat with `file:line` citations calling the visitor's own Gemini key directly from the browser; Ollama mode with the CORS connectivity check.
4. Then the map: layered canvas map, source viewer, citation-to-node highlighting.

(Superseded: the previous list started with self-hosted Supabase on the free-tier VM - that whole track is v2 now.)

## Log

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
