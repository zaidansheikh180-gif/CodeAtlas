# CodeAtlas v1.5 - VS Code extension plan

Status: PLAN ONLY (2026-10-17). Written for owner review. No branch, no
scaffolding, no publishing config exists yet. Building anything below waits
for the owner's explicit approval, per the owner's instruction: finish the
web app first, plan the extension, ask before any new branch or repo
setting.

## 1. Goal

Run CodeAtlas inside VS Code (and the forks below) so a developer can index
the workspace they already have open, see the architecture map in an editor
panel, chat with the index, and jump from any file:line citation straight
into the real file at that line - reusing the existing web app instead of
rewriting it.

Compatibility targets, one extension build:

- VS Code (current stable; engines.vscode to be pinned at build time,
  tentatively ^1.96.0)
- Cursor
- Windsurf
- VSCodium (published via Open VSX, since VSCodium does not use the
  Microsoft Marketplace)

Nothing Microsoft-proprietary is used, so a single VSIX serves all four.

## 2. Non-goals for v1.5

- No server, accounts, sync, or telemetry. The static-only v1 privacy model
  is unchanged: the index lives in the webview's IndexedDB on the user's
  machine; model calls go directly from the webview to the model provider
  with the visitor's own key.
- No language-server integration, no inline diagnostics, no code actions.
- No editing of code from the extension. CodeAtlas reads; the editor edits.
- No MCP server (later phase, per the owner's ordering).
- No Marketplace automation, ratings, or badge plumbing beyond a plain
  installable VSIX plus an Open VSX publish step.

## 3. Feature set for v1.5

1. Index the open workspace folder. The workspace root replaces the web
   app's folder picker: the extension host walks it and feeds the same
   indexing worker pipeline, so filtering, secret scanning, parsing and
   graph building are identical to the web app's local-folder mode.
2. Map panel in the IDE. A webview panel (editor area) hosts the existing
   app: the module map, explorer, search, and every current panel render as
   they do in the browser.
3. Chat with citations. The existing model chat (graph-first retrieval,
   budgets, streaming, cancel) works unchanged. Clicking a file:line
   citation opens the real file at that line in the editor instead of the
   in-app viewer.
4. Semantic extraction BYOK. Same Gemini-key / Ollama-endpoint flow; in the
   extension the key is offered through VS Code SecretStorage (never
   written to settings.json or any file).
5. Watch mode. VS Code's FileSystemWatcher replaces the 5s polling loop
   when running inside the extension, reusing the same incremental update
   path.

Everything else about v1 (settings, privacy report, diagnostics, export,
snapshots, communities, feedback, performance mode, accessibility,
onboarding) rides along for free because the same app bundle runs inside
the webview.

## 4. Architecture

One repository, two build outputs, one shared app:

```
CodeAtlas/
  src/ ...                  (existing web app - unchanged feature code)
  extension/
    package.json            (extension manifest: commands, views, engines)
    src/extension.ts        (extension host entry, TypeScript)
    src/bridge.ts           (host side of the message bridge)
    media/                  (vite build output copied here at package time)
  src/lib/host.ts           (NEW: host port abstraction in the web app)
  src/lib/host-browser.ts   (NEW: today's behavior, as the browser port)
  src/lib/host-vscode.ts    (NEW: postMessage RPC port for the webview)
```

The extension host is a small TypeScript program bundled to one CommonJS
file (esbuild). The webview loads the normal Vite production build of the
app with `localResourceRoots` restricted to `media/` and a strict CSP (see
section 6).

### 4.1 The host bridge (the core design)

Today the web app talks to three browser-only surfaces: the File System
Access picker (src/lib/localfolder.ts), browser key storage
(src/lib/keys.ts), and the in-app file viewer for citations
(ChatPanel's `onOpenCitation(path, line)` prop, which already exists as a
clean seam). The plan introduces a narrow `Host` port in src/lib/host.ts:

```ts
export interface Host {
  kind: 'browser' | 'vscode'
  // Folder intake: browser picks a directory; vscode reads the workspace.
  pickFolderEntries(): Promise<LocalFileEntry[] | null>
  // Open a file at a line: browser opens the in-app viewer;
  // vscode reveals the real editor at the line.
  openFileAtLine(path: string, line?: number): void
  // Key storage: browser keeps memory/localStorage behavior;
  // vscode offers SecretStorage through the bridge.
  saveSecret(id: string, value: string): Promise<void>
  loadSecret(id: string): Promise<string | null>
  // Watch: browser polls (existing); vscode forwards FileSystemWatcher events.
  watchFolder?(onChange: (events: WatchEvent[]) => void): () => void
}
```

`host-browser.ts` wraps exactly what the app does today, so the web app is
behavior-identical after the refactor. `host-vscode.ts` implements the same
port over `acquireVsCodeApi().postMessage` with request/response ids; the
extension host answers using `vscode.workspace.fs`, `vscode.window
.showTextDocument(uri, { selection })`, `context.secrets`, and
`vscode.workspace.createFileSystemWatcher`. LocalFileEntry (path, size,
lastModified, contentHash, text) is already the worker intake shape, so the
pipeline downstream does not know which host fed it.

The app detects its host at startup: `window.acquireVsCodeApi` exists only
inside a VS Code webview, so main.tsx picks the port without any build-time
flag and one bundle serves both targets.

### 4.2 What the extension host itself does

- Contributes a "CodeAtlas: Open map" command plus an activity-bar view
  container with one webview view (sidebar entry point) that opens or
  focuses the editor-area map panel.
- On panel open: if the workspace is not indexed yet, walks the workspace
  root (respecting .gitignore via the existing filter stage's skip list,
  not full gitignore semantics in v1.5) and streams entries to the webview
  over the bridge.
- Answers bridge RPCs (section 4.1).
- Holds no index state and no keys of its own beyond SecretStorage.

### 4.3 What deliberately does not change

- The indexing worker, tree-sitter WASM parsing, the IndexedDB schema, and
  every panel component. Webviews support Web Workers, IndexedDB,
  localStorage and WASM eval under the CSP below, so the heavy machinery
  runs as-is.
- The privacy model. GitHub mode also still works inside the webview for
  users who paste a URL, exactly as in the browser.

## 5. Citation jump (open file at cited line)

The chat already validates citations against the sent context and calls
`onOpenCitation(path, line)`. In the extension the vscode host maps that to:

```
vscode.window.showTextDocument(
  vscode.Uri.joinPath(workspaceRoot, path),
  { selection: new vscode.Range(line - 1, 0, line - 1, 0), preview: true }
)
```

Map node clicks and explorer double-clicks route through the same host
method, so "open the real file" works from every surface, not only chat.

## 6. Webview CSP and resource rules

Planned CSP for the webview HTML, keeping v1's no-telemetry stance:

- `default-src 'none'`
- `img-src ${webview.cspSource} data:`
- `style-src ${webview.cspSource} 'unsafe-inline'` (Tailwind injects at
  runtime; fonts are bundled locally)
- `font-src ${webview.cspSource}`
- `script-src ${webview.cspSource} 'wasm-unsafe-eval'` (tree-sitter WASM)
- `worker-src ${webview.cspSource} blob:`
- `connect-src https://api.github.com https://raw.githubusercontent.com
  https://codeload.github.com https://generativelanguage.googleapis.com
  http://localhost:* http://127.0.0.1:*` (GitHub indexing, Gemini, and
  local Ollama; nothing else)

All app assets are bundled into media/ at package time; the extension makes
no CDN requests. The tree-sitter WASM grammars already ship in the app
bundle, so the VSIX is fully offline-capable for indexing local folders.

## 7. Packaging and distribution

- `bun run build` produces the app; a package script copies dist/ into
  extension/media/ and esbuilds extension/src to one .cjs file.
- `vsce package` (or `npx @vscode/vsce package`) produces a single
  codeatlas-<version>.vsix that installs into VS Code, Cursor, Windsurf,
  and VSCodium alike ("Install from VSIX...").
- Open VSX publishing (open-vsx.org) covers VSCodium/Cursor/Windsurf
  marketplace installs; it needs a publisher namespace and a personal
  access token, both of which require the owner's accounts - flagged in
  section 9 as decisions, not assumptions.
- Microsoft Marketplace publishing is optional and left to the owner; the
  VSIX path above already covers every target without it.
- Expected VSIX size: the app bundle plus WASM grammars, roughly the
  current dist size (single-digit MB). No attempt at per-language lazy
  grammar loading in v1.5.

## 8. Testing plan

- Web app stays green as-is: the host refactor is covered by running the
  existing bun test suite (209 tests) against host-browser defaults, plus
  new unit tests for host-vscode's RPC encode/decode against a mocked
  postMessage.
- `bun run build` must keep passing with the new files (tsc --noEmit).
- Extension host: compile check plus a manual smoke matrix before any
  publish: install the VSIX in VS Code and in VSCodium, open a real
  workspace, index it, open the map, ask a chat question with a test key,
  click a citation and confirm the editor reveals the right line, save and
  reload a SecretStorage key, and confirm watch updates after a file edit.
- The existing Playwright E2E suite keeps covering the browser app; a
  VS Code integration test harness (@vscode/test-electron) is optional in
  v1.5 and only added if the smoke matrix proves flaky.

## 9. Open questions for the owner (decisions needed before/at build)

1. Branch name for the work: proposal `vscode-ext`, created from instinct
   after approval.
2. Open VSX publisher namespace name and token (owner's account - cannot
   be created without them).
3. Extension display name and icon: reuse "CodeAtlas" with the current
   dragonfruit accent, or a separate name?
4. Minimum VS Code version: ^1.96.0 as proposed, or lower for older
   Cursor/Windsurf builds?
5. Should the Microsoft Marketplace listing happen at all in v1.5, or
   VSIX + Open VSX only?

## 10. Rollout steps once approved

1. Create branch `vscode-ext` from instinct (owner approves the name).
2. Land the host port refactor (host.ts, host-browser.ts, host-vscode.ts)
   on instinct first, keeping the browser app behavior-identical, so the
   extension branch stays a thin layer.
3. Scaffold extension/ (manifest, host entry, bridge) on the new branch.
4. Wire packaging (media copy, esbuild, vsce) and produce the first VSIX.
5. Run the smoke matrix (section 8) in VS Code and VSCodium; fix and
   repeat until clean.
6. Docs on the branch updated to match (ARCHITECTURE.md, PROGRESS.md,
   README install section), then report for the owner's pull-and-check.
7. Open VSX publish only with the owner's namespace and token in hand.
