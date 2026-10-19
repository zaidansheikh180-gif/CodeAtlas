# Security policy

## API-key handling

No built CodeAtlas feature requires an API key. The optional model layer (live since 2026-10-17) holds keys in memory by default; remembering a Gemini key in this browser's localStorage is opt-in, and keys are never written to IndexedDB, cookies or the repo. A key is sent only to the model provider you choose, only when you explicitly ask. A one-click wipe clears everything, including a remembered key. Do not paste real keys, tokens or credentials into documentation, issues or test fixtures.

### GitHub tokens

The optional GitHub token (private repositories, higher rate limits) is memory-only by design: it is never written to localStorage, IndexedDB or the repository, and it travels only as an `Authorization` header on the visitor's own GitHub API requests. Closing the tab discards it.

## Data leaving the browser

- **GitHub-URL indexing:** repository file contents are downloaded over the GitHub API to your browser and processed locally. Nothing about your graph is sent anywhere.
- **Local-folder mode:** file contents never leave your device; no network calls are made for them at all.
- **Model chat (live since 2026-10-17):** the Chat panel sends your question plus the retrieved context files to the provider you configured, directly from your browser, only when you press send. The composer shows the token estimate and file count before each send, and every message records the exact context paths that were sent. Answer citations are validated against that context - invented paths are dropped. There is no CodeAtlas server in the path.
- **Semantic extraction (live since 2026-10-17):** the Semantic panel sends exactly the files listed in its scope confirmation to the provider you configured (Google Gemini with your own key, or your own Ollama endpoint), directly from your browser, only when you press run. The first run shows a privacy notice naming the destination, the file list and the estimated tokens. Findings are stored only in this browser, are always marked INFERRED, and can be deleted per run.
- There are no analytics, trackers or third-party beacons.

## Sensitive-file exclusions

Secret scanning runs at index time; files that match credential patterns (private keys, tokens, `.env`-style files) are excluded from the graph and counted in the repo stats. The settings page ships configurable sensitive-file globs (added 2026-10-17). Excluded files are never sent to a model provider because they never enter the graph.

## Reporting vulnerabilities

This repository has no public issue tracker for security reports yet. Until one exists, report vulnerabilities privately to the owner through the channel you already use to reach them, with steps to reproduce and the commit you tested against. Please do not include real secrets or private repository URLs in a report.
