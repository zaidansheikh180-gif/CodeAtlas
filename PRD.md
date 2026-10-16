# CodeAtlas product requirements

Status: pre-code. Everything here is planned. Sources: [README.md](README.md), [ROADMAP.md](ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md). Update this file when the product scope changes.

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| App Name | CodeAtlas |
| Tagline | Paste any GitHub repo - get an interactive architecture map and chat that answers from the actual code, with file:line citations. |
| Problem | Understanding an unfamiliar codebase before changing it is slow. Developers read files one by one with no view of how modules connect. Existing code-graph and repo tools exist, but CodeAtlas aims for one readable map plus cited answers in a single place. Who feels it: anyone opening a repo they did not write (contributors, reviewers, students, people evaluating a project). |
| Target User | A developer or learner who has a public GitHub repository URL and wants to understand its structure fast. They may not want to create an account just to look at a map, and they bring their own model access if they want chat. Further persona detail: TBD. |
| Core Features (Must Have) | All planned, none built.<br>- Paste a public GitHub repo URL and index it.<br>- Per-stage indexing progress with honest status.<br>- Interactive layered architecture map (modules, then files, then symbols), readable at the top level.<br>- Source viewer opened from any node.<br>- Chat that answers from the code with clickable `file:line` citations checked against the indexed commit.<br>- Citations light up the matching map node.<br>- Three model modes: no-key map browsing, bring-your-own Gemini key, own Ollama endpoint. No owner or shared key, ever.<br>- Repository size caps and secret scanning before any code reaches a model.<br>- Honest failure states (oversized repo, unsupported language, quota hit, unreachable endpoint). |
| Nice to Have | Superseded 2026-10-16 (see Release-one scope decision below): shareable links, pre-indexed examples, account history, incremental indexing, impact views, guided tours, exports, more languages, PR comparisons and agent integrations are now in the v1 catalogue. Private repos are moved to v2 (FR-042, accepted 2026-10-16). The feature set follows the tools that inspired it; that is a scope statement, not a claim of current parity. |
| Out of Scope | For the first release: private repositories, any shared or owner-paid model key, public performance or parity claims before they are measured, light theme. (Earlier text also excluded everything under Nice to Have; superseded 2026-10-16.) |
| User Stories | - As a developer, I want to paste a repo URL and see its architecture so that I understand the codebase before I change it.<br>- As a visitor without an API key, I want to explore the map and source so that I get value without setup or cost.<br>- As a developer, I want to ask a question and get an answer with `file:line` citations so that I can check it against the code.<br>- As a user, I want to use my own Gemini key or Ollama endpoint so that my chats never use anyone else's quota.<br>- As a user, I want to share a read-only map link so that a teammate can explore without installing anything. |
| Success Metrics | TBD. No targets have been set, and none will be invented. Candidates to decide on, to be measured after the demo exists: share of citations that verify against the indexed commit, indexing success rate on a test set of repos, time to first readable map. Phase gates in the roadmap require tests, a usable demo and measured results. |

## Release-one scope decision (owner, 2026-10-16)

Status: Chosen. The owner asked that v1 include all the functions of the related starred tools (graphify, Understand-Anything, codegraph, code-review-graph, repomix, archify, headroom, graph-engineering), not defer them. This supersedes the earlier split into a smaller first release and a later "depth" phase. Owner decisions on flagged items are recorded in the rows below; private repos (FR-042) were moved to v2 by the owner on 2026-10-16. Nothing here is built. Sources are the public READMEs of those repos, read on 2026-10-16.

Scale note: this is a much larger v1 than before. The plan in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) orders the work in vertical slices so a usable core exists early, but "everything in v1" means v1 ships later. No dates are given.

## Requirements catalogue

All rows: Priority = Must (v1, per owner decision), Status = Planned. Journey and test IDs link to [APP_FLOW.md](APP_FLOW.md) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
### Ingest and safety

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-001 | Paste a public GitHub URL (also branch, tag or commit URLs) and index it | repomix, codegraph | Feasible |  | JRN-001 | TASK-004 | TEST-001 |
| FR-002 | Per-stage indexing progress with honest status | own | Feasible |  | JRN-001 | TASK-004 | TEST-002 |
| FR-003 | Size caps and a cost estimate shown before indexing or chat | repomix (token counts) | Feasible | Cap values TBD (measured in phase 1) | JRN-001 | TASK-003 | TEST-003 |
| FR-004 | Secret scanning before any code reaches a model; excluded files listed | repomix (secretlint) | Feasible | Reduces exposure, not a guarantee | JRN-001 | TASK-005 | TEST-004 |
| FR-005 | Honest failure states (oversized, not found, unsupported language, quota, unreachable endpoint) | own | Feasible |  | JRN-001, JRN-002 | TASK-024 | TEST-005 |

### Graph building (no LLM)

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-006 | Structural graph from tree-sitter: imports, calls, contains, inherits, resolved across files | graphify, codegraph, code-review-graph | Feasible with caveat | Cross-file resolution quality differs per language; measured per language, not assumed | JRN-001 | TASK-007 | TEST-006 |
| FR-007 | Every edge tagged EXTRACTED or INFERRED, with an extracted-only filter (numeric score TBD) | graphify, code-review-graph | Feasible |  | JRN-001 | TASK-007 | TEST-007 |
| FR-008 | Broad language coverage: JS/TS and Python first, then more grammars | graphify (~40), codegraph (20+) | Chosen (owner, 2026-10-16): JS/TS and Python for v1 | Owner approved JS/TS and Python for v1. Matching the 20 to 40 languages of the inspiring tools is not reachable now; other languages degrade to files only and are labelled so | JRN-001 | TASK-008 | TEST-008 |
| FR-009 | Framework-aware route linking (URL pattern to handler) | codegraph (17 frameworks), code-review-graph | Chosen (owner, 2026-10-16) | v1 subset picked by us, owner said pick: Next.js, Express, NestJS (JS/TS) and FastAPI, Flask, Django (Python). Other frameworks marked later | JRN-001 | TASK-009 | TEST-009 |
| FR-010 | Communities (Leiden) with LLM-free labels, god nodes and hubs, bridge nodes | graphify, code-review-graph | Feasible |  | JRN-001 | TASK-010 | TEST-010 |
| FR-011 | Surprise scoring (unexpected coupling) and knowledge-gap analysis (isolated nodes, untested hotspots) | code-review-graph | Feasible with caveat | Test-gap detection needs a test-file convention per language; labelled heuristic | JRN-003 | TASK-011 | TEST-011 |
| FR-012 | Execution flows: call chains from entry points, sorted by criticality | code-review-graph | Feasible with caveat | Entry-point detection is weaker outside a few languages in the source tool; same expectation here | JRN-001 | TASK-011 | TEST-012 |
| FR-013 | Rationale and doc references (# NOTE / # WHY comments, ADR/RFC links) as graph nodes | graphify | Feasible |  | JRN-001 | TASK-012 | TEST-013 |
| FR-014 | Docs in the graph: Markdown and text docs (no key). PDFs and images via the user's own model | graphify | Feasible with caveat | Audio/video transcription is NOT planned for v1, see Flags | JRN-001 | TASK-012 | TEST-014 |

### Explore the map

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-015 | Interactive layered map: modules, then files, then symbols, readable at the top level | own, archify, graphify | Feasible | Top-level node count (about 8 to 12) is a Proposed default, not tested | JRN-001 | TASK-014 | TEST-015 |
| FR-016 | Source viewer and caller / source / callee view from any node | codegraph | Feasible |  | JRN-001 | TASK-015 | TEST-016 |
| FR-017 | Search: full-text, fuzzy and semantic (semantic needs the user's own model) | Understand-Anything, codegraph, code-review-graph | Feasible | Full-text uses Postgres; semantic uses pgvector | JRN-001 | TASK-016 | TEST-017 |
| FR-018 | Path between two nodes, explain one node, and depth-limited traversal from any node | graphify, code-review-graph | Feasible |  | JRN-001 | TASK-016 | TEST-018 |
| FR-019 | Plain-English node and module summaries (user's own model; marked as generated) | Understand-Anything | Feasible | Generated text is always labelled, never mixed with parsed facts | JRN-001, JRN-005 | TASK-018 | TEST-019 |
| FR-020 | Guided tours ordered by dependency, and a 'start here' path | Understand-Anything | Feasible | Order comes from the graph; narration needs the user's model | JRN-005 | TASK-018 | TEST-020 |
| FR-021 | Domain view: code mapped to business domains, flows and steps | Understand-Anything | Feasible with caveat | LLM-derived, so labelled generated and checkable against source | JRN-005 | TASK-019 | TEST-021 |
| FR-022 | Detail level by persona (for example Newcomer and Engineer views) | Understand-Anything | Feasible | Persona names TBD | JRN-005 | TASK-019 | TEST-022 |
| FR-023 | Non-visual alternative to the map: a navigable tree or list | own (accessibility) | Feasible |  | JRN-001 | TASK-014 | TEST-023 |

### Ask the code

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-024 | Chat answers with clickable file:line citations verified against the indexed commit; citations light up the map node | own | Feasible |  | JRN-002 | TASK-017 | TEST-024 |
| FR-025 | Three model modes: no key (map only), own Gemini key, own Ollama endpoint. No owner or shared key, ever | own (owner decision 2026-10-09) | Feasible with caveat | Ollama mode needs a safe design for user-supplied URLs before it ships | JRN-002 | TASK-006 | TEST-025 |
| FR-026 | Hybrid retrieval (vector plus graph walk); the answer shows which files and nodes it used and what it did not see | own | Feasible |  | JRN-002 | TASK-017 | TEST-026 |
| FR-027 | Starter and suggested questions drawn from hubs, bridges and structure | code-review-graph | Feasible |  | JRN-002 | TASK-017 | TEST-027 |
| FR-028 | Token counts per file and per repo, and context trimming (tree-sitter compression) before a model call | repomix, headroom | Feasible with caveat | Only the in-app trimming idea is adopted; headroom's proxy and agent wrappers are not. Savings figures are shown as estimated | JRN-002 | TASK-013 | TEST-028 |

### Change impact

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-029 | Blast radius: callers, callees and the likely impact of changing a symbol | code-review-graph, codegraph, Understand-Anything | Feasible with caveat | Conservative, so false positives are expected and shown as such | JRN-003 | TASK-020 | TEST-029 |
| FR-030 | Impact view for a public PR or commit range, with a risk score | code-review-graph, Understand-Anything | Feasible with caveat | Risk-score formula TBD and must be explainable | JRN-003 | TASK-020 | TEST-030 |
| FR-031 | Before and after architecture compare for two commits | own (north star) | Feasible |  | JRN-003 | TASK-020 | TEST-031 |
| FR-032 | GitHub Action that posts a risk-scored PR comment calling the hosted API | code-review-graph | Chosen for v1 (owner, 2026-10-16) | Needs a token and abuse policy, and a private-repo story. In v1. Token and abuse design is required first (TASK-029) | JRN-003 | TASK-026 | TEST-032 |

### Freshness

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-033 | Incremental re-index when a repo has a new commit (hash-based, only changed files) | codegraph, code-review-graph, Understand-Anything | Feasible with caveat | Hosted version re-indexes on request or by polling. A local file watcher does not apply | JRN-001 | TASK-021 | TEST-033 |

### Share and export

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-034 | Read-only share link that reproduces the view, with a social preview card | archify | Feasible |  | JRN-004 | TASK-022 | TEST-034 |
| FR-035 | Embed button for a shared map | own (north star) | Feasible |  | JRN-004 | TASK-022 | TEST-035 |
| FR-036 | Exports: PNG, SVG, JSON, GraphML, Neo4j Cypher, Obsidian vault, standalone HTML | code-review-graph, archify | Feasible | SVG/PNG rendering approach TBD | JRN-004 | TASK-023 | TEST-036 |
| FR-037 | Pack the repo into one AI-friendly file (XML, Markdown or JSON) with token counts and optional compression | repomix | Feasible | Secret scanning applies first | JRN-004 | TASK-023 | TEST-037 |
| FR-038 | Generated Markdown wiki from community structure (user's own model) | code-review-graph | Feasible |  | JRN-004 | TASK-023 | TEST-038 |

### Agents and teams

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test |
|---|---|---|---|---|---|---|---|
| FR-039 | Hosted MCP endpoint so coding agents can query a map | codegraph, code-review-graph, graphify | Chosen for v1 (owner, 2026-10-16) | Needs auth, rate limits and abuse rules. In v1. Token and abuse design is required first (TASK-029). A local stdio CLI is not planned | JRN-006 | TASK-025 | TEST-039 |
| FR-040 | Refactor helpers: rename preview and dead-code candidates (read-only, nothing is edited) | code-review-graph | Feasible with caveat | Static analysis, labelled candidates not facts | JRN-003 | TASK-020 | TEST-040 |
| FR-041 | Register several repos and search across them | code-review-graph, graphify | Feasible with caveat | Needs accounts | JRN-006 | TASK-025 | TEST-041 |
| FR-042 | Private repositories through GitHub OAuth | (all inspirations run locally) | Accepted: v2 | Owner accepted on 2026-10-16: not in v1, first item of v2, because it adds token, storage and privacy risk. Stays listed, not dropped | JRN-006 | TASK-027 | TEST-042 |
| FR-043 | Custom language definitions without a fork | code-review-graph | Chosen for v1 (owner, 2026-10-16) | Hosted version needs a safe sandboxed config. In v1. Safe sandboxed config design is part of TASK-008 | JRN-006 | TASK-008 | TEST-043 |
| FR-044 | Measured token benchmark per question (graph context vs whole repo), shown as estimated | code-review-graph, graphify | Feasible | No parity or savings claim before measured | JRN-002 | TASK-028 | TEST-044 |

### Inspired-by features NOT adopted (flagged, not silently dropped)

| Feature | Source | Why not in v1 | Decision |
|---|---|---|---|
| Local CLI, git hooks, editor hooks, agent installers, local SQLite | codegraph, code-review-graph, graphify | CodeAtlas is a hosted web app, not a local tool. The hosted equivalents are FR-033 and FR-039 | Confirmed out of v1 (owner, 2026-10-16) |
| Native file watcher | codegraph | Needs local files. Replaced by FR-033 | Confirmed out of v1 (owner, 2026-10-16) |
| Rust parsing kernel and Linux-kernel-scale indexing | codegraph | Free-tier VM cannot index 70k-file repos. Size caps apply (FR-003). No speed claims | Confirmed out of v1 (owner, 2026-10-16) |
| Audio and video transcription into the graph | graphify | Local speech models are too heavy for a small VM. Docs, PDFs and images via the user's own model are in (FR-014) | Confirmed out of v1 (owner, 2026-10-16) |
| Diagram from a plain description with no repo | archify | A different product from repo-to-map. Standalone HTML export of a map is in (FR-036) | Confirmed out of v1 (owner, 2026-10-16) |
| Browser extension and VS Code extension | repomix | Separate products | Confirmed out of v1 (owner, 2026-10-16) |
| Proxy, agent wrapping, cross-agent memory, failure-mining | headroom | Apply to agent sessions, not to a hosted repo explorer. Only context trimming is adopted (FR-028) | Confirmed out of v1 (owner, 2026-10-16) |
| Continuous monorepo graph, formal verification, Sentry and Jira connectors | graphify Cloud (paid product) | Commercial cloud features, not part of the open tool | Confirmed out of v1 (owner, 2026-10-16) |
| UI in many languages (en, zh, ja, ko, ru, vi) | Understand-Anything | Not requested by the owner. English only for now | Confirmed out of v1 (owner, 2026-10-16) |
| Knowledge-base (LLM wiki) analysis mode | Understand-Anything | Outside the repo-to-map concept | Confirmed out of v1 (owner, 2026-10-16) |

## Acceptance criteria (Must items)

Status: Proposed. Criteria are written per requirement group and finalised with each task. They must be observable and use no unmeasured number.

- FR-001 to FR-005: a pasted public URL either yields an indexed commit with visible per-stage progress, or a named failure state that says what to try. No secret-flagged file reaches a model.
- FR-006 to FR-014: for a test repo, every extracted edge carries a confidence tag, and parsed facts are visibly separate from generated text.
- FR-015 to FR-023: every node opens its source; the map has a non-visual equivalent.
- FR-024 to FR-028: every citation is checked against the indexed commit; unverifiable ones are flagged; with no key, chat shows setup and the map still works.
- FR-029 to FR-033: an impact result lists what it covers and what it could not resolve.
- FR-034 to FR-038: a share link reproduces the view; exports contain the same graph as the map.
- Measured thresholds (speed, recall, success rate): TBD, none invented.

## Non-functional requirements

Status: TBD for numbers. NFR-001 Privacy: no owner or shared model key (Chosen). NFR-002 Security: user keys encrypted at rest and never logged (Chosen). NFR-003 Accessibility: WCAG AA contrast, keyboard access, non-visual map alternative (Chosen, per [UI_UX_BRIEF.md](UI_UX_BRIEF.md)). NFR-004 Cost: nothing paid by the owner at runtime (Chosen). NFR-005 Capacity: must run on one free-tier VM; real headroom unmeasured (TBD). NFR-006 Mobile: layouts work on phones (Chosen).

## Assumptions and risks

- Assumption: the free-tier VM can hold Supabase, API and worker together. Impact if wrong: caps shrink or hosting changes. Check: measure in TASK-002.
- Assumption: tree-sitter gives usable cross-file edges for the first languages. Impact if wrong: more INFERRED edges. Check: per-language measurement.
- Risk: v1 scope is now large. Mitigation: vertical slices and owner decisions on flagged items.

## Open questions

- Target metrics and the test set of repos.
- Primary persona beyond the one-line description.
- Which "Nice to Have" items belong to the first public release.
- Language list (JS/TS, Python) and framework subset are decided.
- Persona names for FR-022.
