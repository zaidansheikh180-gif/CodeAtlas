# CodeAtlas product requirements

Status: pre-code. Everything here is planned. Sources: [README.md](README.md), [ROADMAP.md](ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md). Update this file when the product scope changes.

| Field | Content |
|---|---|
| App Name | CodeAtlas |
| Tagline | Paste any GitHub repo - get an interactive architecture map and chat that answers from the actual code, with file:line citations. |
| Problem | Understanding an unfamiliar codebase before changing it is slow. Developers read files one by one with no view of how modules connect. Existing code-graph and repo tools exist, but CodeAtlas aims for one readable map plus cited answers in a single place. Who feels it: anyone opening a repo they did not write (contributors, reviewers, students, people evaluating a project). |
| Target User | A developer or learner who has a public GitHub repository URL and wants to understand its structure fast. They may not want to create an account just to look at a map, and they bring their own model access if they want chat. Further persona detail: TBD. |
| Core Features (Must Have) | All planned, none built.<br>- Paste a public GitHub repo URL and index it.<br>- Per-stage indexing progress with honest status.<br>- Interactive layered architecture map (modules, then files, then symbols), readable at the top level.<br>- Source viewer opened from any node.<br>- Chat that answers from the code with clickable `file:line` citations checked against the indexed commit.<br>- Citations light up the matching map node.<br>- Three model modes: no-key map browsing, bring-your-own Gemini key, own Ollama endpoint. No owner or shared key, ever.<br>- Repository size caps and secret scanning before any code reaches a model.<br>- Honest failure states (oversized repo, unsupported language, quota hit, unreachable endpoint). |
| Nice to Have | Read-only shareable map links and pre-indexed examples (planned for the demo phase). Later: account history, incremental indexing, impact views, guided tours, exports, more languages. To evaluate separately: private repos, PR comparisons, agent integrations. The long-term direction is a feature superset of the tools that inspired it; that is a direction, not a claim of current parity. |
| Out of Scope | For the first release: private repositories, any shared or owner-paid model key, public performance or parity claims before they are measured, light theme, anything listed under Nice to Have. |
| User Stories | - As a developer, I want to paste a repo URL and see its architecture so that I understand the codebase before I change it.<br>- As a visitor without an API key, I want to explore the map and source so that I get value without setup or cost.<br>- As a developer, I want to ask a question and get an answer with `file:line` citations so that I can check it against the code.<br>- As a user, I want to use my own Gemini key or Ollama endpoint so that my chats never use anyone else's quota.<br>- As a user, I want to share a read-only map link so that a teammate can explore without installing anything. |
| Success Metrics | TBD. No targets have been set, and none will be invented. Candidates to decide on, to be measured after the demo exists: share of citations that verify against the indexed commit, indexing success rate on a test set of repos, time to first readable map. Phase gates in the roadmap require tests, a usable demo and measured results. |

## Open questions

- Target metrics and the test set of repos.
- Primary persona beyond the one-line description.
- Which "Nice to Have" items belong to the first public release.
