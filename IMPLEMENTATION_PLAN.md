# CodeAtlas implementation plan

Status: pre-code. This follows the build-sequence template. The product-level order is in [ROADMAP.md](ROADMAP.md), which stays the public summary; this file breaks it into phases with done criteria. Log real progress in [PROGRESS.md](PROGRESS.md).

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
| Done Criteria | Release one is done when a visitor can paste a public repo URL (or open an example), browse a readable map with no key, and with their own Gemini key or Ollama endpoint get cited answers that verify against the indexed commit, with honest failure states and no owner key anywhere. Later depth (accounts history, incremental indexing, impact views, guided tours, exports, more languages) comes after. |

## Mapping to the roadmap

Roadmap phases 1 to 4 correspond to phases 1 to 9 here. Roadmap phase 5 (depth) is after this plan.

## Open questions

- Whether auth should move before the first end-to-end demo.
- Test repo set and measurement method.
