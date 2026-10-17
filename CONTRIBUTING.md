# Contributing to CodeAtlas

## Project structure

```
src/
  components/   React UI: map, panels, search, onboarding (one feature per file)
  lib/          Pure TypeScript logic: graph, queries, search, exports, storage.
                Every module has a sibling <name>.test.ts.
  workers/      The indexing/search worker (parsing, graph build, queries, search)
  types/        Shared type re-exports
  App.tsx       App shell and routing
  theme.css     Design tokens (see DESIGN.md)
docs/           User-facing reference
```

Key rules: `src/lib` modules stay UI-free and testable; anything expensive (parsing, traversal, search) runs in the worker; IndexedDB is the only store; no backend calls beyond the GitHub API and (in the planned model layer) the visitor's own provider.

## Development commands

```
bun install        # install dependencies (Bun 1.3+)
bun run dev        # dev server on http://localhost:5173
bun test           # unit tests (bun:test), currently 176
bun run build      # type-check + production build
```

## Testing expectations

- Every `src/lib` change ships with unit tests in its sibling `.test.ts`; keep the suite green with `bun test` before pushing.
- Test behavior, not implementation: ranking order, truncation flags, edge tagging, persistence round-trips.
- UI changes need a manual pass in `bun run dev` on a small real repo (express is a good size); visual changes need a screenshot check against DESIGN.md.
- Never write repo files while a Playwright measurement is running against the dev server; Vite full-reloads and silently invalidates the measurement.

## Code style

- TypeScript strict; no `any` without a comment saying why.
- Follow existing patterns: small pure functions in `src/lib`, React state in components, Dexie for storage, DESIGN.md colors (Dragonfruit `#FF4696`, Night Violet `#1E1033`), flat surfaces, no gradients.
- Naming: modules are lowercase (`graphquery.ts`), components PascalCase (`MapCanvas.tsx`).
- Keep docs honest: if behavior changes, update README/docs/ARCHITECTURE in the same change. Docs on the branch must match the code.

## Pull-request checklist

1. `bun test` green and `bun run build` clean.
2. New logic has sibling unit tests; UI verified in the dev server on a real repo.
3. Docs updated (README, docs/USER_GUIDE.md, ARCHITECTURE.md, PROGRESS.md entry).
4. No secrets, tokens or private repository URLs anywhere.
5. Accessibility: keyboard path and focus-visible states for new interactive UI; live regions for async results.
6. Target the working branch agreed with the owner (currently `instinct`); `main` holds documentation only until the owner merges.
