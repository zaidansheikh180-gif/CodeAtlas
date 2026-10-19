# CodeAtlas product requirements

Status: v1 feature-complete on the `instinct` branch (2026-10-19). Build state is marked per row in the catalogue notes and logged in [PROGRESS.md](PROGRESS.md); unmarked notes remain planned. Sources: [README.md](README.md), [ROADMAP.md](ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md). Update this file when the product scope changes.

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| App Name | CodeAtlas |
| Tagline | Paste any GitHub repo - get an interactive architecture map and chat that answers from the actual code, with file:line citations. |
| Problem | Understanding an unfamiliar codebase before changing it is slow. Developers read files one by one with no view of how modules connect. Existing code-graph and repo tools exist, but CodeAtlas aims for one readable map plus cited answers in a single place. Who feels it: anyone opening a repo they did not write (contributors, reviewers, students, people evaluating a project). |
| Target User | A developer or learner who has a public GitHub repository URL and wants to understand its structure fast. They may not want to create an account just to look at a map, and they bring their own model access if they want chat. Further persona detail: TBD. |
| Core Features (Must Have) | Built on `instinct` (2026-10-19): paste-and-index with branch/tag/commit picker, per-stage progress, the layered module map with drill-down, the source viewer, size caps, secret scanning, honest failure states, key-free graph queries, repo-wide search, chat with citations and the model modes (own Gemini key or Ollama endpoint).<br>- Paste a public GitHub repo URL and index it.<br>- Per-stage indexing progress with honest status.<br>- Interactive layered architecture map (modules, then files, then symbols), readable at the top level.<br>- Source viewer opened from any node.<br>- Chat that answers from the code with clickable `file:line` citations checked against the indexed commit.<br>- Citations light up the matching map node.<br>- Three model modes: no-key map browsing, bring-your-own Gemini key, own Ollama endpoint. No owner or shared key, ever.<br>- Repository size caps and secret scanning before any code reaches a model.<br>- Honest failure states (oversized repo, unsupported language, quota hit, unreachable endpoint). |
| Nice to Have | Superseded 2026-10-16 (see Release-one scope decision below): shareable links, pre-indexed examples, account history, incremental indexing, impact views, guided tours, exports, more languages, PR comparisons and agent integrations are now in the v1 catalogue. Private repos are moved to v2 (FR-042, accepted 2026-10-16). Update 2026-10-16 (evening): the static-only v1 decision moved the server-dependent catalogue items (FR-032, FR-039, FR-041, hosted parts of FR-034/FR-035) to v2 as well. The feature set follows the tools that inspired it; that is a scope statement, not a claim of current parity. |
| Out of Scope | For the first release: private repositories, any shared or owner-paid model key, public performance or parity claims before they are measured. (Light theme was listed here and shipped 2026-10-17.) Update 2026-10-16 (evening): also out of v1 - everything that needs a server: the hosted MCP endpoint, the GitHub Action, accounts and history, hosted share previews and embeds, and server-side storage. (Earlier text also excluded everything under Nice to Have; superseded 2026-10-16.) |
| User Stories | - As a developer, I want to paste a repo URL and see its architecture so that I understand the codebase before I change it.<br>- As a visitor without an API key, I want to explore the map and source so that I get value without setup or cost.<br>- As a developer, I want to ask a question and get an answer with `file:line` citations so that I can check it against the code.<br>- As a user, I want to use my own Gemini key or Ollama endpoint so that my chats never use anyone else's quota.<br>- As a user, I want to share a read-only map link so that a teammate can explore without installing anything. |
| Success Metrics | TBD. No targets have been set, and none will be invented. Candidates to decide on, to be measured after the demo exists: share of citations that verify against the indexed commit, indexing success rate on a test set of repos, time to first readable map. Phase gates in the roadmap require tests, a usable demo and measured results. |

## Release-one scope decision (owner, 2026-10-16)

Status: Chosen. The owner asked that v1 include all the functions of the related starred tools (graphify, Understand-Anything, codegraph, code-review-graph, repomix, archify, headroom, graph-engineering), not defer them. This supersedes the earlier split into a smaller first release and a later "depth" phase. Owner decisions on flagged items are recorded in the rows below; private repos (FR-042) were moved to v2 by the owner on 2026-10-16. The browser spine shipped on `instinct` in phases 1-2 (2026-10-16); the rest is planned. Sources are the public READMEs of those repos, read on 2026-10-16.

Scale note: this is a much larger v1 than before. The plan in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) orders the work in vertical slices so a usable core exists early, but "everything in v1" means v1 ships later. No dates are given.

## Static-only v1 decision (owner, 2026-10-16, evening)

Status: Chosen. The owner asked whether CodeAtlas needs a backend at all and chose a static-only v1: no server, no database server, no accounts, no hosted API. The browser fetches the public repository from the GitHub API (the git tree listing plus raw file downloads - measured in phase 2: the zipball endpoint is not CORS-readable from a browser, so the original archive-first reading changed), parses it with tree-sitter compiled to WASM inside a Web Worker, builds and stores the graph in IndexedDB, and calls the visitor's own Gemini key or Ollama endpoint directly for chat, summaries and embeddings. This supersedes the server-based reading of the release-one scope decision above: the scope of functions stays, but everything that fundamentally needs a server moves to v2.

Moved to v2 by this decision: the hosted MCP endpoint (FR-039), the GitHub Action that calls a hosted API (FR-032), the multi-repo registry with accounts (FR-041), the hosted parts of sharing (social preview card and hosted iframe embed in FR-034 and FR-035), and with them the API server, the indexing worker, self-hosted Supabase, accounts and the token/abuse design (TASK-029). Private repositories (FR-042) were already accepted for v2 earlier the same day.

Consequences now recorded in the catalogue below: every row carries a Release column. Browser-side risks are flagged in the Note column (GitHub's anonymous rate limit, large-repo performance in one tab, Ollama CORS setup) with their mitigations. Values that need measuring (size caps, performance) stay TBD and will be measured, not assumed.

Follow-up decisions the same evening (owner): visitors may optionally paste their own GitHub token, stored only in their browser, to raise the rate limit; the landing-page examples ship as bundled pre-built graphs so the demo is instant and costs no rate limit; the GitHub Action stays v2, with the CI-local variant (no hosted API) as its planned v2 form. Update 2026-10-19: the examples shipped instead as one-click example chips (lukeed/uid, developit/mitt, jonschlinkert/is-number) that index live from GitHub through the normal confirm flow; bundled pre-built graphs remain unbuilt.

## Requirements catalogue

Rows are Status = Planned unless the Note column records a build state (recorded 2026-10-19). The Release column (added 2026-10-16, evening) shows the static-only v1 split: v1 static = runs fully in the browser; v2 = needs a server; Split = partly both. Rows marked Must under the earlier all-in-v1 decision keep that priority within their release. Journey and test IDs link to [APP_FLOW.md](APP_FLOW.md) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
### Ingest and safety

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-001 | Paste a public GitHub URL (also branch, tag or commit URLs) and index it | repomix, codegraph | Feasible | Static v1 (updated 2026-10-16, phase 2): the browser fetches the git tree listing (one API request) and then raw file downloads - the zipball endpoint turned out not to be CORS-readable from a browser. The anonymous GitHub API limit is about 60 requests/hour per visitor IP, so keeping API calls to the tree request matters. An optional visitor-supplied GitHub token, stored only in their browser, raises the limit (Chosen, owner, 2026-10-16 evening) Built. | JRN-001 | TASK-004 | TEST-001 | v1 static |
| FR-002 | Per-stage indexing progress with honest status | own | Feasible |  Built. | JRN-001 | TASK-004 | TEST-002 | v1 static |
| FR-003 | Size caps and a cost estimate shown before indexing or chat | repomix (token counts) | Feasible | Caps set in phase 1: 4000 files, 25 MB source, 1 MB per file, 256 KB parse guard. In static v1 the caps reflect one browser tab's memory, not a VM. Built. | JRN-001 | TASK-003 | TEST-003 | v1 static |
| FR-004 | Secret scanning before any code reaches a model; excluded files listed | repomix (secretlint) | Feasible | Reduces exposure, not a guarantee Built. | JRN-001 | TASK-005 | TEST-004 | v1 static |
| FR-005 | Honest failure states (oversized, not found, unsupported language, quota, unreachable endpoint) | own | Feasible |  Built. | JRN-001, JRN-002 | TASK-024 | TEST-005 | v1 static |

### Graph building (no LLM)

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-006 | Structural graph from tree-sitter: imports, calls, contains, inherits, resolved across files | graphify, codegraph, code-review-graph | Feasible with caveat | Cross-file resolution quality differs per language; measured per language, not assumed. Static v1: tree-sitter runs as WASM in a Web Worker so parsing does not freeze the page Built 2026-10-16 (imports, calls, contains; no inherits edge type). | JRN-001 | TASK-007 | TEST-006 | v1 static |
| FR-007 | Every edge tagged EXTRACTED or INFERRED, with an extracted-only filter (numeric score TBD) | graphify, code-review-graph | Feasible |  Built. | JRN-001 | TASK-007 | TEST-007 | v1 static |
| FR-008 | Broad language coverage: JS/TS and Python first, then more grammars | graphify (~40), codegraph (20+) | Chosen (owner, 2026-10-16): JS/TS and Python for v1 | Owner approved JS/TS and Python for v1. Matching the 20 to 40 languages of the inspiring tools is not reachable now; other languages degrade to files only and are labelled so Built as scoped. | JRN-001 | TASK-008 | TEST-008 | v1 static |
| FR-009 | Framework-aware route linking (URL pattern to handler) | codegraph (17 frameworks), code-review-graph | Chosen (owner, 2026-10-16) | v1 subset picked by us, owner said pick: Next.js, Express, NestJS (JS/TS) and FastAPI, Flask, Django (Python). Other frameworks marked later Not built (2026-10-19). | JRN-001 | TASK-009 | TEST-009 | v1 static |
| FR-010 | Communities (Leiden) with LLM-free labels, god nodes and hubs, bridge nodes | graphify, code-review-graph | Feasible |  Partially built 2026-10-17: deterministic greedy-modularity communities (not Leiden) with LLM-free labels and community stats. | JRN-001 | TASK-010 | TEST-010 | v1 static |
| FR-011 | Surprise scoring (unexpected coupling) and knowledge-gap analysis (isolated nodes, untested hotspots) | code-review-graph | Feasible with caveat | Test-gap detection needs a test-file convention per language; labelled heuristic Not built (2026-10-19). | JRN-003 | TASK-011 | TEST-011 | v1 static |
| FR-012 | Execution flows: call chains from entry points, sorted by criticality | code-review-graph | Feasible with caveat | Entry-point detection is weaker outside a few languages in the source tool; same expectation here Partially built 2026-10-17: call-flow view from any symbol; entry-point chains sorted by criticality not built. | JRN-001 | TASK-011 | TEST-012 | v1 static |
| FR-013 | Rationale and doc references (# NOTE / # WHY comments, ADR/RFC links) as graph nodes | graphify | Feasible |  Not built (2026-10-19). | JRN-001 | TASK-012 | TEST-013 | v1 static |
| FR-014 | Docs in the graph: Markdown and text docs (no key). PDFs and images via the user's own model | graphify | Feasible with caveat | Audio/video transcription is NOT planned for v1, see Flags Partially built: Markdown and docs appear as file/module nodes; PDF and image extraction not built. | JRN-001 | TASK-012 | TEST-014 | v1 static |

### Explore the map

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-015 | Interactive layered map: modules, then files, then symbols, readable at the top level | own, archify, graphify | Feasible | Top-level node count (about 8 to 12) is a Proposed default, not tested Built. | JRN-001 | TASK-014 | TEST-015 | v1 static |
| FR-016 | Source viewer and caller / source / callee view from any node | codegraph | Feasible |  Built. | JRN-001 | TASK-015 | TEST-016 | v1 static |
| FR-017 | Search: full-text, fuzzy and semantic (semantic needs the user's own model) | Understand-Anything, codegraph, code-review-graph | Feasible | Superseded 2026-10-16 (evening): full-text and fuzzy search run client-side over the IndexedDB index; semantic search embeds with the visitor's own key and compares vectors locally, so it needs a key. Earlier note: full-text was to use Postgres and semantic pgvector (server plan, now v2) Partially built 2026-10-17: exact/case-insensitive/prefix/fuzzy/regex built; vector semantic search not built (semantic questions hand off to chat). | JRN-001 | TASK-016 | TEST-017 | v1 static |
| FR-018 | Path between two nodes, explain one node, and depth-limited traversal from any node | graphify, code-review-graph | Feasible |  Built. | JRN-001 | TASK-016 | TEST-018 | v1 static |
| FR-019 | Plain-English node and module summaries (user's own model; marked as generated) | Understand-Anything | Feasible | Generated text is always labelled, never mixed with parsed facts Not built (2026-10-19). | JRN-001, JRN-005 | TASK-018 | TEST-019 | v1 static |
| FR-020 | Guided tours ordered by dependency, and a 'start here' path | Understand-Anything | Feasible | Order comes from the graph; narration needs the user's model Not built (the app onboarding tour is separate and shipped). | JRN-005 | TASK-018 | TEST-020 | v1 static |
| FR-021 | Domain view: code mapped to business domains, flows and steps | Understand-Anything | Feasible with caveat | LLM-derived, so labelled generated and checkable against source Not built (2026-10-19). | JRN-005 | TASK-019 | TEST-021 | v1 static |
| FR-022 | Detail level by persona (for example Newcomer and Engineer views) | Understand-Anything | Feasible | Persona names TBD Not built (2026-10-19). | JRN-005 | TASK-019 | TEST-022 | v1 static |
| FR-023 | Non-visual alternative to the map: a navigable tree or list | own (accessibility) | Feasible |  Built (screen-reader module list, keyboard map). | JRN-001 | TASK-014 | TEST-023 | v1 static |

### Ask the code

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-024 | Chat answers with clickable file:line citations verified against the indexed commit; citations light up the map node | own | Feasible |  Built 2026-10-17. | JRN-002 | TASK-017 | TEST-024 | v1 static |
| FR-025 | Three model modes: no key (map only), own Gemini key, own Ollama endpoint. No owner or shared key, ever | own (owner decision 2026-10-09) | Feasible with caveat | Static v1: the browser calls the visitor's Gemini key or Ollama endpoint directly; the earlier server-side request-safety concern no longer applies. Ollama must allow the site's origin (OLLAMA_ORIGINS) on the visitor's machine; the setup card must detect a CORS failure and explain the fix Built. | JRN-002 | TASK-006 | TEST-025 | v1 static |
| FR-026 | Hybrid retrieval (vector plus graph walk); the answer shows which files and nodes it used and what it did not see | own | Feasible |  Partially built 2026-10-17: graph-first retrieval built; vector retrieval not built. | JRN-002 | TASK-017 | TEST-026 | v1 static |
| FR-027 | Starter and suggested questions drawn from hubs, bridges and structure | code-review-graph | Feasible |  Not built (2026-10-19). | JRN-002 | TASK-017 | TEST-027 | v1 static |
| FR-028 | Token counts per file and per repo, and context trimming (tree-sitter compression) before a model call | repomix, headroom | Feasible with caveat | Only the in-app trimming idea is adopted; headroom's proxy and agent wrappers are not. Savings figures are shown as estimated Partially built: token estimates and context budgets built; per-file token counts not built. | JRN-002 | TASK-013 | TEST-028 | v1 static |

### Change impact

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-029 | Blast radius: callers, callees and the likely impact of changing a symbol | code-review-graph, codegraph, Understand-Anything | Feasible with caveat | Conservative, so false positives are expected and shown as such Built (with likely affected tests). | JRN-003 | TASK-020 | TEST-029 | v1 static |
| FR-030 | Impact view for a public PR or commit range, with a risk score | code-review-graph, Understand-Anything | Feasible with caveat | Risk-score formula TBD and must be explainable. Static v1: PR and commit-range data comes from the GitHub compare API and counts against the same per-visitor rate limit Not built (2026-10-19). | JRN-003 | TASK-020 | TEST-030 | v1 static |
| FR-031 | Before and after architecture compare for two commits | own (north star) | Feasible | Static v1: both commits are indexed in the browser; heavy on large repos, so it inherits the size caps Partially built: snapshot compare built; arbitrary commit-pair compare not built. | JRN-003 | TASK-020 | TEST-031 | v1 static |
| FR-032 | GitHub Action that posts a risk-scored PR comment calling the hosted API | code-review-graph | Chosen for v1 (owner, 2026-10-16) | Superseded 2026-10-16 (evening): moved to v2 because it calls a hosted API that no longer exists in v1. A variant that runs the analysis inside the CI job itself, with no hosted API, is the planned v2 form of this feature (owner, 2026-10-16 evening) | JRN-003 | TASK-026 | TEST-032 | v2 |

### Freshness

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-033 | Incremental re-index when a repo has a new commit (hash-based, only changed files) | codegraph, code-review-graph, Understand-Anything | Feasible with caveat | Static v1: re-index runs in the browser on request; the stored commit is compared with the default branch (GitHub compare API) and only changed files are reprocessed. There is no server to poll Built. | JRN-001 | TASK-021 | TEST-033 | v1 static |

### Share and export

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-034 | Read-only share link that reproduces the view, with a social preview card | archify | Feasible | Static v1: the link carries the repo, commit and view state; the recipient's browser re-indexes the repo (rate limits apply). The social preview card needs a server and moves to v2. The standalone HTML export (FR-036) is the portable share in v1 Update 2026-10-19: URL share links and the standalone HTML export are not built; the portable share today is the graph JSON export file. | JRN-004 | TASK-022 | TEST-034 | Split |
| FR-035 | Embed button for a shared map | own (north star) | Feasible | Static v1: sharing a finished map means the exported standalone HTML file (FR-036). A hosted iframe embed needs a server and moves to v2 | JRN-004 | TASK-022 | TEST-035 | Split |
| FR-036 | Exports: PNG, SVG, JSON, GraphML, Neo4j Cypher, Obsidian vault, standalone HTML | code-review-graph, archify | Feasible | SVG/PNG rendering approach TBD. Static v1: every format is generated in the browser; the standalone HTML export becomes the main way to share a finished map Partially built 2026-10-17: PNG, graph JSON, Map JSON, Mermaid and GraphML built; SVG, Cypher, Obsidian vault and standalone HTML not built. | JRN-004 | TASK-023 | TEST-036 | v1 static |
| FR-037 | Pack the repo into one AI-friendly file (XML, Markdown or JSON) with token counts and optional compression | repomix | Feasible | Secret scanning applies first. Static v1: packing runs in the browser and is memory-bound on large repos; inherits the size caps Not built (2026-10-19). | JRN-004 | TASK-023 | TEST-037 | v1 static |
| FR-038 | Generated Markdown wiki from community structure (user's own model) | code-review-graph | Feasible |  Not built (2026-10-19). | JRN-004 | TASK-023 | TEST-038 | v1 static |

### Agents and teams

| ID | Requirement | Inspired by | v1 feasibility | Note | Journey | Task | Test | Release |
|---|---|---|---|---|---|---|---|---|
| FR-039 | Hosted MCP endpoint so coding agents can query a map | codegraph, code-review-graph, graphify | Chosen for v1 (owner, 2026-10-16) | Superseded 2026-10-16 (evening): moved to v2 - a hosted MCP endpoint needs a server, and v1 has none. A local stdio CLI remains not planned | JRN-006 | TASK-025 | TEST-039 | v2 |
| FR-040 | Refactor helpers: rename preview and dead-code candidates (read-only, nothing is edited) | code-review-graph | Feasible with caveat | Static analysis, labelled candidates not facts Not built (2026-10-19). | JRN-003 | TASK-020 | TEST-040 | v1 static |
| FR-041 | Register several repos and search across them | code-review-graph, graphify | Feasible with caveat | Needs accounts and cross-repo storage, so it moves to v2 with the accounts plan (2026-10-16, evening) | JRN-006 | TASK-025 | TEST-041 | v2 |
| FR-042 | Private repositories through GitHub OAuth | (all inspirations run locally) | Accepted: v2 | Owner accepted on 2026-10-16: not in v1, first item of v2, because it adds token, storage and privacy risk. Stays listed, not dropped | JRN-006 | TASK-027 | TEST-042 | v2 |
| FR-043 | Custom language definitions without a fork | code-review-graph | Chosen for v1 (owner, 2026-10-16) | Static v1: custom grammars ship as WASM files loaded into the visitor's own browser, which is itself the sandbox; the earlier server-side sandbox concern no longer applies. Grammar-to-WASM tooling is part of TASK-008 Not built (2026-10-19). | JRN-006 | TASK-008 | TEST-043 | v1 static |
| FR-044 | Measured token benchmark per question (graph context vs whole repo), shown as estimated | code-review-graph, graphify | Feasible | No parity or savings claim before measured Not built (2026-10-19). | JRN-002 | TASK-028 | TEST-044 | v1 static |

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
- Update 2026-10-16 (evening): criteria for v2 items are deferred with them. v1 criteria additionally include: indexing completes within the GitHub anonymous rate limit for a small repo (or the optional-token path is shown), and the whole flow runs in a normal browser tab without freezing it.
- Measured thresholds (speed, recall, success rate): TBD, none invented.

## Non-functional requirements

Status: TBD for numbers. NFR-001 Privacy: no owner or shared model key (Chosen). NFR-002 Security: updated 2026-10-16 (evening) - in v1 keys live only in the visitor's browser storage and are sent nowhere but the chosen model provider; never logged. Earlier text (server plan, v2): user keys encrypted at rest and never logged (Chosen). NFR-003 Accessibility: WCAG AA contrast, keyboard access, non-visual map alternative (Chosen, per [UI_UX_BRIEF.md](UI_UX_BRIEF.md)). NFR-004 Cost: nothing paid by the owner at runtime (Chosen). NFR-005 Capacity: superseded 2026-10-16 (evening) - there is no VM in v1; capacity means one browser tab, measured in phase 1. Original text: must run on one free-tier VM; real headroom unmeasured (TBD). NFR-007 (added 2026-10-16, evening, Chosen): v1 is a static site; all state lives in the visitor's browser and nothing about a visitor is stored by the project. NFR-006 Mobile: layouts work on phones (Chosen).

## Assumptions and risks

- Assumption: superseded 2026-10-16 (evening) by the static-only v1 decision; there is no VM in v1. Original: the free-tier VM can hold Supabase, API and worker together.
- Assumption (added 2026-10-16, evening; updated 2026-10-16, phase 2): a small-to-medium public repository can be fetched within the GitHub anonymous rate limit. The archive-first path was replaced by tree+raw fetching (zipball not CORS-readable); a large repo (django, 3595 files) indexed fully in the phase-2 measurement without a token. Remaining impact if wrong: indexing stalls for visitors without a token. Check: more repos in phase 3.
- Assumption (added 2026-10-16, evening): tree-sitter WASM parsing and graph building stay responsive in one browser tab for repos under the size caps. Impact if wrong: caps shrink. Check: measure in phase 1.
- Assumption: tree-sitter gives usable cross-file edges for the first languages. Impact if wrong: more INFERRED edges. Check: per-language measurement.
- Risk: v1 scope is now large. Mitigation: vertical slices and owner decisions on flagged items.

## Open questions

- Target metrics and the test set of repos.
- Primary persona beyond the one-line description.
- Which "Nice to Have" items belong to the first public release.
- Language list (JS/TS, Python) and framework subset are decided.
- Persona names for FR-022.
- Decided 2026-10-16 (evening, owner): yes - visitors may optionally paste their own GitHub token, stored only in their browser, to raise the rate limit.
- Decided 2026-10-16 (evening, owner): landing examples ship as bundled pre-built graphs with the static site.
- Decided 2026-10-16 (evening, owner): the GitHub Action stays v2; the CI-local variant (analysis inside the CI job, no hosted API) is its planned v2 form.
- How the v1 share link (re-index on open) and the exported standalone HTML map should relate.
