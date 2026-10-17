# Security policy

## API-key handling

No built CodeAtlas feature requires or stores an API key. The planned optional model layer is designed around memory-only keys: a key you paste is held in memory, never written to IndexedDB, localStorage, cookies or the repo, and is sent only to the model provider you choose, only when you explicitly ask a question. A one-click wipe clears it. Do not paste real keys, tokens or credentials into documentation, issues or test fixtures.

## Data leaving the browser

- **GitHub-URL indexing:** repository file contents are downloaded over the GitHub API to your browser and processed locally. Nothing about your graph is sent anywhere.
- **Local-folder mode:** file contents never leave your device; no network calls are made for them at all.
- **Planned model chat:** when it ships, only the retrieved context (the files and symbols shown in the context list) goes to your chosen provider, on explicit ask, over a direct browser-to-provider connection. There is no CodeAtlas server in the path.
- There are no analytics, trackers or third-party beacons.

## Sensitive-file exclusions

Secret scanning runs at index time; files that match credential patterns (private keys, tokens, `.env`-style files) are excluded from the graph and counted in the repo stats. The planned settings page adds configurable sensitive-file globs. Excluded files are never sent to a model provider because they never enter the graph.

## Reporting vulnerabilities

This repository has no public issue tracker for security reports yet. Until one exists, report vulnerabilities privately to the owner through the channel you already use to reach them, with steps to reproduce and the commit you tested against. Please do not include real secrets or private repository URLs in a report.
