# CodeAtlas app flow

Status: v1 in build on the `instinct` branch. Built screens are marked; the rest are planned.

Scope update 2026-10-16 (evening, owner decision): v1 is static-only. There are no accounts in v1; everything below that mentions sign-in or a server is annotated. Indexing runs in the visitor's browser; state lives in the browser's IndexedDB. Visual rules are in [DESIGN.md](DESIGN.md); UI details in [UI_UX_BRIEF.md](UI_UX_BRIEF.md).

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| Pages List | Route paths are TBD. Planned screens:<br>- Landing: one URL input and a few pre-indexed examples.<br>- Repo view: map, source viewer and chat on one screen.<br>- Settings: model mode (Gemini key, Ollama endpoint), stored only in this browser.<br>- Share view: read-only map for a public repo link. Static v1 (2026-10-16, evening): a share link carries the repo, commit and view state, and the recipient's browser re-indexes the repo; the exported standalone HTML file is the portable share that opens instantly. The hosted social preview card and iframe embed are v2. |
| Navigation Type | Desktop: map as the main canvas with a side panel for source, callers and callees, and the chat alongside. Breadcrumb for drill-down depth. Search with `/` or Cmd-K anywhere. Mobile: map is viewable and tappable, panels open as bottom sheets. Final layout: TBD. |
| First Screen | A new visitor sees the landing: a URL input and pre-indexed example repos they can open with no account or key. No marketing filler and no made-up stats. |
| Auth Flow | Superseded for v1 (2026-10-16, evening): v1 has no accounts at all. Per-user state (saved model key, chat history, indexed repos) lives only in the visitor's browser storage. Accounts return in v2 with the server. Original text: Map browsing needs no account. An account is planned only where per-user state is needed (saved model key, chat history). Sign-in method and onboarding: TBD. |
| Core User Journey 1 (JRN-001) | Explore a repo with no key. User pastes a public GitHub URL (or opens an example). The app validates it and shows the size estimate. Indexing starts in the browser with per-stage progress (downloading the archive, filtering, parsing in a worker, building the graph, saving to IndexedDB). Update 2026-10-16 (evening): these stages replaced the server-side clone; if the GitHub anonymous rate limit is hit, a named state shows the wait time and the optional-token path (Chosen, owner, 2026-10-16 evening). The map opens at the top level with about 8 to 12 modules. User clicks a module to open its files, then symbols, with a breadcrumb back. Clicking a node opens its source and callers and callees. The URL keeps the repo, commit and view state. Update 2026-10-16 (evening): on the same browser the stored index opens instantly; on another browser the link triggers a fresh index from GitHub. |
| Core User Journey 2 (JRN-002) | Ask the code a question. User opens chat. With no key, a calm setup card offers a Gemini key or an Ollama endpoint, and the map stays usable. After setup the user asks a question, or picks a starter question drawn from the repo's structure. The answer streams with `path:line` citation chips. Clicking a chip opens the source at that line and lights up the node on the map. An unverifiable citation shows as unverified. The panel shows which files and nodes the answer used. |
| Empty States | Landing with only the URL input and examples. Empty chat shows starter questions. |
| Error States | Each says what failed and what to try next:<br>- Repo too large, with the caps shown.<br>- Repo not found.<br>- GitHub anonymous rate limit hit: shows the wait time and the optional-token path (Chosen, 2026-10-16 evening).<br>- Unsupported language (the map is shallower, files only).<br>- Quota hit on the user's own key (wait, another key, or Ollama).<br>- Ollama endpoint unreachable.<br>- Files excluded by secret scanning or size caps are listed.<br>Loading uses skeletons that match the final layout. |
| Redirects | TBD. Intent: a finished indexing job opens the repo view; a share link opens the read-only map; pasting a URL that is already indexed opens the existing map instead of re-indexing (to be confirmed). |

## Modal, drawer and overlay interactions

- Node click opens a side panel (bottom sheet on mobile).
- Citation click opens the source viewer at the line.
- Search opens as an overlay from `/` or Cmd-K.
- No-key setup is a card inside the chat panel, not a blocking modal.

## Screen inventory

Routes are TBD. SCR-001, SCR-002 and SCR-003 (map and source preview) are built on the `instinct` branch (2026-10-16); the rest are Planned.

| ID | Screen | Purpose | Entry | Role | Main actions |
|---|---|---|---|---|---|
| SCR-001 | Landing | Paste URL, open examples | Root | Anyone | Submit URL, open example |
| SCR-002 | Indexing | Per-stage progress | After submit | Anyone | Wait, cancel (TBD) |
| SCR-003 | Repo view | Map, source, chat, search | After indexing, share link | Anyone (chat needs a model) | Drill down, search, ask |
| SCR-004 | Impact view | Blast radius, PR or commit compare | Repo view | Anyone | Pick symbol, PR or two commits |
| SCR-005 | Tour view | Guided tour, start-here path, persona views | Repo view | Anyone (summaries need a model) | Step through, switch persona |
| SCR-006 | Share and export | Link, embed, exports, packed file, wiki | Repo view | Anyone | Copy link, download |
| SCR-007 | Settings | Model mode, keys, tokens | Menu | Anyone; stored only in this browser (2026-10-16, evening) | Save or delete key |
| SCR-008 | Agent access | MCP endpoint info, tokens | Settings | Signed-in | Create or revoke token. Moved to v2 (2026-10-16, evening) with FR-039 |

## Additional journeys

Each: trigger, preconditions, steps, result, requirement IDs. Status: Planned.

- **JRN-003 Check the impact of a change.** Trigger: user opens SCR-004 on an indexed repo. Steps: pick a symbol, or paste a public PR or commit range (fetched through the GitHub compare API, counting against the visitor's rate limit); the app lists affected symbols, flows and test gaps with a risk score; each item opens its source. Result: an impact list that states what it could not resolve. Failure: PR not found or too large, shown with the caps. Requirements: FR-029, FR-030, FR-031, FR-011, FR-040.
- **JRN-004 Share and export.** Trigger: user opens SCR-006. Steps: copy a read-only link (the recipient's browser re-indexes the repo), or download PNG, SVG, JSON, GraphML, Cypher, Obsidian vault, standalone HTML, a packed repo file, or a wiki. Result: file or link that matches the current map. Update 2026-10-16 (evening): the generated social preview card and the hosted embed move to v2; in v1 the standalone HTML export is the way to share a finished map. Requirements: FR-034 to FR-038.
- **JRN-005 Learn the codebase in order.** Trigger: user opens SCR-005. Steps: start the tour; steps follow the dependency order; summaries are labelled generated; switch persona to change detail. Without a model: order and structure are shown, summaries show a setup card. Requirements: FR-019 to FR-022.
- **JRN-006 Use CodeAtlas from an agent or CI.** Superseded 2026-10-16 (evening): moved to v2 with the static-only v1 decision, because the hosted MCP endpoint and the GitHub Action's hosted API need a server. Original text: Trigger: signed-in user creates an access token. Steps: configure the MCP endpoint or the GitHub Action; call returns graph context. In v1 per owner decision; depends on the token and abuse design (TASK-029). Private repos (FR-042) are accepted for v2. A CI-local Action variant (analysis inside the CI job, no hosted API) is Proposed and undecided (FR-032).

## State matrix

Status: Proposed. For each screen: initial, loading (skeleton), success, empty, invalid input, service error, permission denied (private or missing repo), disabled (no key), retry. Copy for each state is listed in [DESIGN.md](DESIGN.md) under States. Retry is safe for read actions; indexing retry reuses the same commit.

## Forms

- URL input: accepts a public GitHub repo, branch, tag, commit or PR URL; validates inline; keeps the typed value on error; duplicate submit of an indexed URL opens the existing map (to be confirmed).
- Settings: Gemini key field (masked, deletable), Ollama URL field. Static v1 (2026-10-16, evening): both are stored only in this browser; the Ollama field ships with a connectivity check that detects CORS failures and explains the OLLAMA_ORIGINS fix.

## Journey-to-test links

JRN-001: TEST-001 to TEST-018, TEST-023. JRN-002: TEST-024 to TEST-028, TEST-044. JRN-003: TEST-011, TEST-029 to TEST-032, TEST-040. JRN-004: TEST-034 to TEST-038. JRN-005: TEST-019 to TEST-022. JRN-006: TEST-039, TEST-041 (v2). TEST-043 (custom languages) runs in the browser in v1. Test definitions are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Open questions

- Route names. (2026-10-16, evening: accounts are settled for v1 - there are none; the question returns with v2.)
- Whether a repo URL already indexed is reused or re-indexed. In v1: reused from IndexedDB when the commit matches, with an explicit re-index action (Proposed).
- Cancel behavior for a running in-browser index job.
- Decided 2026-10-16 (evening, owner): the landing examples ship as bundled pre-built graphs with the static site, so the demo is instant and costs the visitor no rate limit.
