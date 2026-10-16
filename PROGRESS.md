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

Share a read-only map link with a social preview image, embed it, or export PNG, SVG and JSON. Whole project runs on a self-hosted Supabase, and the project ships with a one-file self-host setup. There is never a shared or owner key.

Long-term north star (a superset of what existing code-graph tools offer, done in one hosted place):
- Understanding: blast radius, community and module summaries, path between two nodes, guided tours ordered by dependency, a "start here" path, plain-English node summaries, Newcomer and Engineer views.
- Collaboration and reach: route share cards, embed button, Obsidian export, PR and diff impact views, before and after architecture compare, GitHub Action, and an MCP endpoint for coding agents.
- Depth: incremental re-index on new commits, more languages, docs and rationale notes in the graph, private repos through GitHub OAuth, a light theme, ask-from-map scoped questions, and a local versus cloud answer comparison page.

The first release is the smaller core: URL in, layered map, citation chat with your own key, shareable links and a few pre-indexed examples. The rest follows in waves, and each item is only claimed once it ships.

## Current status

Pre-code. Documentation only. No app, schema or deployment yet.

## Next up

Phase 1, the spine:

1. Self-hosted Supabase on the free-tier VM, with a backup job; measure real headroom.
2. Indexing worker for one small public repo: clone, filter, secret scan, chunk, embed with a supplied key.
3. Chat with `file:line` citations, using vector retrieval only, with the user's own key.
4. Then the map (phase 2): tree-sitter symbols and edges, layered canvas map, source viewer.

## Log

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
