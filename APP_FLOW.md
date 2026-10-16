# CodeAtlas app flow

Status: pre-code. Screens and paths below are planned. Visual rules are in [DESIGN.md](DESIGN.md); UI details in [UI_UX_BRIEF.md](UI_UX_BRIEF.md).

| Field | Content |
|---|---|
| Pages List | Route paths are TBD. Planned screens:<br>- Landing: one URL input and a few pre-indexed examples.<br>- Repo view: map, source viewer and chat on one screen.<br>- Settings: model mode (Gemini key, Ollama endpoint).<br>- Share view: read-only map for a public repo link. |
| Navigation Type | Desktop: map as the main canvas with a side panel for source, callers and callees, and the chat alongside. Breadcrumb for drill-down depth. Search with `/` or Cmd-K anywhere. Mobile: map is viewable and tappable, panels open as bottom sheets. Final layout: TBD. |
| First Screen | A new visitor sees the landing: a URL input and pre-indexed example repos they can open with no account or key. No marketing filler and no made-up stats. |
| Auth Flow | Map browsing needs no account. An account is planned only where per-user state is needed (saved model key, chat history). Sign-in method and onboarding: TBD. |
| Core User Journey 1 | Explore a repo with no key. User pastes a public GitHub URL (or opens an example). The app validates it and shows the size estimate. Indexing starts with per-stage progress (cloning, filtering, parsing, graph). The map opens at the top level with about 8 to 12 modules. User clicks a module to open its files, then symbols, with a breadcrumb back. Clicking a node opens its source and callers and callees. The URL keeps the view, so the link reproduces it. |
| Core User Journey 2 | Ask the code a question. User opens chat. With no key, a calm setup card offers a Gemini key or an Ollama endpoint, and the map stays usable. After setup the user asks a question, or picks a starter question drawn from the repo's structure. The answer streams with `path:line` citation chips. Clicking a chip opens the source at that line and lights up the node on the map. An unverifiable citation shows as unverified. The panel shows which files and nodes the answer used. |
| Empty States | Landing with only the URL input and examples. Empty chat shows starter questions. |
| Error States | Each says what failed and what to try next:<br>- Repo too large, with the caps shown.<br>- Repo not found.<br>- Unsupported language (the map is shallower, files only).<br>- Quota hit on the user's own key (wait, another key, or Ollama).<br>- Ollama endpoint unreachable.<br>- Files excluded by secret scanning or size caps are listed.<br>Loading uses skeletons that match the final layout. |
| Redirects | TBD. Intent: a finished indexing job opens the repo view; a share link opens the read-only map; pasting a URL that is already indexed opens the existing map instead of re-indexing (to be confirmed). |

## Modal, drawer and overlay interactions

- Node click opens a side panel (bottom sheet on mobile).
- Citation click opens the source viewer at the line.
- Search opens as an overlay from `/` or Cmd-K.
- No-key setup is a card inside the chat panel, not a blocking modal.

## Open questions

- Route names and whether accounts are needed for anything beyond saved keys and history.
- Whether a repo URL already indexed is reused or re-indexed.
