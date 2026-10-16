# CodeAtlas implementation plan

Status: pre-code. This follows the build-sequence template. The product-level order is in [ROADMAP.md](ROADMAP.md), which stays the public summary; this file breaks it into phases with done criteria. Log real progress in [PROGRESS.md](PROGRESS.md).

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| Phase 1: Setup | Create the app and worker skeletons, folder structure, environment variable names, and self-hosted Supabase on the free-tier VM. Measure real VM headroom. Pick the API framework. Done when: Supabase runs on the VM, the project builds locally, and capacity numbers are recorded. |
| Phase 2: Database | Fix the schema from BACKEND_SCHEMA.md as migrations: repos, files, symbols, edges, chunks, jobs. Enable pgvector. Set size caps and record them. Done when: migrations apply cleanly from empty and a test repo's rows can be written. |
| Phase 3: Auth | Supabase Auth for per-user settings, RLS policies, encrypted key storage. Done when: a user can save and delete a key, no one else can read it, and keys never appear in logs. (Public map browsing stays account-free.) |
| Phase 4: Core Feature 1 | Indexing worker for one small public repo: shallow clone, filtering, secret scanning, tree-sitter parsing, chunks, embeddings with a supplied key. Done when: one small repo indexes end to end with honest per-stage progress and a restart resumes the queue. |
| Phase 5: Core Feature 2 | Chat with citations: retrieval endpoint, vector plus graph context, streamed answers, citation verification against the indexed commit. Done when: answers cite `file:line` that verify, and unverifiable lines are flagged. |
| Phase 6: Core Feature 3 | Architecture map and source viewer: imports and call edges, layered drill-down, no-key graph browsing, citations that light up nodes, edge confidence shown. Done when: a real repo opens as a readable top-level map and every node opens its source. |
| Phase 7: UI Polish | Responsive layouts, loading, empty, error, no-key and quota states from DESIGN.md, Ollama mode with safe endpoint handling, accessibility checks. Done when: every state in DESIGN.md exists and phone layouts work. |
| Phase 8: Testing | Manual and automated tests of all flows, edge cases (huge repos, unsupported languages, bad endpoints, quota errors), secret-scan checks, and measured indexing and answer quality. Done when: tests pass and results are measured and written down. |
| Phase 9: Deploy | Production environment, domain, backups, graph-only public examples, read-only share links, docs written from observed behavior. Done when: a public demo runs with working examples. No performance or parity claims before measurement. |
| Done Criteria | Release one is done when a visitor can paste a public repo URL (or open an example), browse a readable map with no key, and with their own Gemini key or Ollama endpoint get cited answers that verify against the indexed commit, with honest failure states and no owner key anywhere. The depth items (history, incremental indexing, impact views, guided tours, exports, more languages) are now part of release one per the 2026-10-16 owner decision, subject to the flagged items. |

## Mapping to the roadmap

Roadmap phases 1 to 4 correspond to phases 1 to 9 here. Roadmap phase 5 (depth) was moved into release one on 2026-10-16 (see the scope update above and [ROADMAP.md](ROADMAP.md)).


## Release-one scope update (owner, 2026-10-16)

Status: Chosen. v1 now includes all functions of the related starred tools. See the requirements catalogue in [PRD.md](PRD.md). The nine phases above stay as the order of work; the tasks below are assigned to them. Phase gates are unchanged: tests, a usable demo and measured results.

## Task catalogue

All tasks: Status Planned. Estimates: none given. Definition of Done for each task: the linked tests pass, results are recorded in [PROGRESS.md](PROGRESS.md), and any numbers are measured, not assumed.

| Task | Phase | Deliverable | Requirements |
|---|---|---|---|
| TASK-001 | Phase 1: Setup | Skeletons, folder structure, env variable names | FR-025 |
| TASK-002 | Phase 1: Setup | Self-hosted Supabase on the VM, backup job, measure real headroom | all |
| TASK-003 | Phase 1: Setup | Size caps and cost estimate | FR-003 |
| TASK-004 | Phase 2: Database | Submit and queue: URL parsing (branch, tag, commit), jobs table, per-stage progress, resume on restart | FR-001, FR-002 |
| TASK-005 | Phase 4: Core Feature 1 (indexing) | Filter and secret scanning | FR-004 |
| TASK-006 | Phase 3: Auth | Model modes: key storage (encrypted), Gemini client, safe Ollama endpoint design | FR-025 |
| TASK-007 | Phase 4: Core Feature 1 (indexing) | tree-sitter extraction (JS/TS, Python) and edges with confidence | FR-006, FR-007 |
| TASK-008 | Phase 9: Deploy and release-one breadth | Language breadth beyond the first two; custom language config design | FR-008, FR-043 |
| TASK-009 | Phase 9: Deploy and release-one breadth | Framework-aware route linking (subset TBD) | FR-009 |
| TASK-010 | Phase 6: Core Feature 3 (map) | Graph analytics: communities, hubs, bridges | FR-010 |
| TASK-011 | Phase 6: Core Feature 3 (map) | Surprise, knowledge gaps, execution flows | FR-011, FR-012 |
| TASK-012 | Phase 6: Core Feature 3 (map) | Docs, rationale and doc-reference nodes | FR-013, FR-014 |
| TASK-013 | Phase 4: Core Feature 1 (indexing) | Chunking, token counting, context trimming | FR-028 |
| TASK-014 | Phase 6: Core Feature 3 (map) | Layered map renderer and non-visual tree view | FR-015, FR-023 |
| TASK-015 | Phase 6: Core Feature 3 (map) | Source viewer and caller/source/callee panel | FR-016 |
| TASK-016 | Phase 6: Core Feature 3 (map) | Search (full-text, fuzzy, semantic), path, explain, traversal | FR-017, FR-018 |
| TASK-017 | Phase 5: Core Feature 2 (chat) | Chat: hybrid retrieval, streaming, citation verification, starter questions | FR-024, FR-026, FR-027 |
| TASK-018 | Phase 6: Core Feature 3 (map) | Generated summaries and guided tours | FR-019, FR-020 |
| TASK-019 | Phase 6: Core Feature 3 (map) | Domain view and persona views | FR-021, FR-022 |
| TASK-020 | Phase 9: Deploy and release-one breadth | Impact: blast radius, PR/commit diff, architecture compare, refactor helpers | FR-029, FR-030, FR-031, FR-040 |
| TASK-021 | Phase 9: Deploy and release-one breadth | Incremental re-index by commit | FR-033 |
| TASK-022 | Phase 9: Deploy and release-one breadth | Share links, preview cards, embed | FR-034, FR-035 |
| TASK-023 | Phase 9: Deploy and release-one breadth | Exports, packed-repo file, wiki | FR-036, FR-037, FR-038 |
| TASK-024 | Phase 7: UI Polish | Error, empty, quota and excluded-file states | FR-005 |
| TASK-025 | Phase 9: Deploy and release-one breadth | Hosted MCP endpoint and multi-repo registry (needs accounts; after TASK-029) | FR-039, FR-041 |
| TASK-026 | Phase 9: Deploy and release-one breadth | GitHub Action (in v1; after TASK-029) | FR-032 |
| TASK-027 | Phase 9: Deploy and release-one breadth | Private repos via GitHub OAuth (accepted for v2 on 2026-10-16; not in v1) | FR-042 |
| TASK-028 | Phase 8: Testing | Measurement harness: token benchmark, indexing success, citation verification rate | FR-044 |
| TASK-029 | Phase 9: Deploy and release-one breadth | Token, rate-limit and abuse design for the MCP endpoint, GitHub Action and share links (design before build) | FR-032, FR-039, FR-034 |

## Traceability: requirement to journey, task and test

| Requirement | Journey | Task | Test |
|---|---|---|---|
| FR-001 | JRN-001 | TASK-004 | TEST-001 |
| FR-002 | JRN-001 | TASK-004 | TEST-002 |
| FR-003 | JRN-001 | TASK-003 | TEST-003 |
| FR-004 | JRN-001 | TASK-005 | TEST-004 |
| FR-005 | JRN-001, JRN-002 | TASK-024 | TEST-005 |
| FR-006 | JRN-001 | TASK-007 | TEST-006 |
| FR-007 | JRN-001 | TASK-007 | TEST-007 |
| FR-008 | JRN-001 | TASK-008 | TEST-008 |
| FR-009 | JRN-001 | TASK-009 | TEST-009 |
| FR-010 | JRN-001 | TASK-010 | TEST-010 |
| FR-011 | JRN-003 | TASK-011 | TEST-011 |
| FR-012 | JRN-001 | TASK-011 | TEST-012 |
| FR-013 | JRN-001 | TASK-012 | TEST-013 |
| FR-014 | JRN-001 | TASK-012 | TEST-014 |
| FR-015 | JRN-001 | TASK-014 | TEST-015 |
| FR-016 | JRN-001 | TASK-015 | TEST-016 |
| FR-017 | JRN-001 | TASK-016 | TEST-017 |
| FR-018 | JRN-001 | TASK-016 | TEST-018 |
| FR-019 | JRN-001, JRN-005 | TASK-018 | TEST-019 |
| FR-020 | JRN-005 | TASK-018 | TEST-020 |
| FR-021 | JRN-005 | TASK-019 | TEST-021 |
| FR-022 | JRN-005 | TASK-019 | TEST-022 |
| FR-023 | JRN-001 | TASK-014 | TEST-023 |
| FR-024 | JRN-002 | TASK-017 | TEST-024 |
| FR-025 | JRN-002 | TASK-006 | TEST-025 |
| FR-026 | JRN-002 | TASK-017 | TEST-026 |
| FR-027 | JRN-002 | TASK-017 | TEST-027 |
| FR-028 | JRN-002 | TASK-013 | TEST-028 |
| FR-029 | JRN-003 | TASK-020 | TEST-029 |
| FR-030 | JRN-003 | TASK-020 | TEST-030 |
| FR-031 | JRN-003 | TASK-020 | TEST-031 |
| FR-032 | JRN-003 | TASK-026 | TEST-032 |
| FR-033 | JRN-001 | TASK-021 | TEST-033 |
| FR-034 | JRN-004 | TASK-022 | TEST-034 |
| FR-035 | JRN-004 | TASK-022 | TEST-035 |
| FR-036 | JRN-004 | TASK-023 | TEST-036 |
| FR-037 | JRN-004 | TASK-023 | TEST-037 |
| FR-038 | JRN-004 | TASK-023 | TEST-038 |
| FR-039 | JRN-006 | TASK-025 | TEST-039 |
| FR-040 | JRN-003 | TASK-020 | TEST-040 |
| FR-041 | JRN-006 | TASK-025 | TEST-041 |
| FR-042 | JRN-006 | TASK-027 | TEST-042 |
| FR-043 | JRN-006 | TASK-008 | TEST-043 |
| FR-044 | JRN-002 | TASK-028 | TEST-044 |

## Test strategy

Status: Proposed. Each TEST-nnn above gets a written check with expected result when its task starts. Kinds: unit (parsers, edge tagging), contract (API), end-to-end (JRN-001 to JRN-006), accessibility (keyboard, non-visual tree, contrast), security (secret scan, key storage, Ollama URL safety, cross-user access), and measurement (indexing success, citation verification rate, token estimates). Test repo set: TBD.

## Critical path

1. VM headroom measured (TASK-002) decides how big the caps and the worker concurrency can be.
2. Language list (JS/TS, Python) and framework subset are decided (owner, 2026-10-16).
3. TASK-029 (token and abuse design) must finish before TASK-025 and TASK-026. FR-042 (private repos) is accepted for v2.

## Vertical slices

Slice 1: URL, index one small JS/TS repo, graph, minimal map, source viewer (no key). Slice 2: add cited chat with a supplied key. Slice 3: analytics, search, summaries, tours. Slice 4: impact views, incremental re-index. Slice 5: sharing, exports, MCP. These are order suggestions inside the one v1 scope.

## Open questions

- Whether auth should move before the first end-to-end demo.
- Test repo set and measurement method.
- Whether v1 can hold this scope on one free-tier VM (measured in TASK-002, not assumed).
