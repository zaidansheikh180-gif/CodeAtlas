# CodeAtlas memory

The living decision log for this repository and its codebase: what was decided, why, and how that decision was put into practice. Keep the history from the first product decisions through implementation and release.

**Seed status: 2026-10-10, pre-code.** The repository contains project documents, not a working app. A decision recorded in a document is not an implemented feature. Each entry below separates the current evidence from the planned implementation.

## How to update this file

- Append new dated entries at the bottom, in the order decisions happen. Use `### YYYY-MM-DD - Short decision title` with **Decision**, **Why**, and **How implemented**.
- Record the reason and any tradeoff, not only the result. If the reason is unknown, say so rather than inventing one.
- For implemented work, name the actual files, migrations, tests and commit references. Record what was verified and what remains untested. Until code exists, name the document that records the plan and say the implementation is pending.
- When a decision changes, append a new entry that points to the earlier one and explains what replaces it. Do not erase the earlier decision.
- Keep [ARCHITECTURE.md](ARCHITECTURE.md) aligned with the current technical design and [DESIGN.md](DESIGN.md) with the current UI rules. [PROGRESS.md](PROGRESS.md) tracks completed work and the end goal; [ROADMAP.md](ROADMAP.md) tracks planned build order. This file preserves the reasons and implementation history.
- Keep entries public-safe. Never include credentials, private infrastructure details, or private source material. Do not claim a feature shipped just because it was planned.

## Decisions

### 2026-10-09 - Choose a repository map and chat product

**Decision:** Build a web app that turns a public GitHub repository into an interactive architecture map and lets users chat with the actual code. Take inspiration from codegraph, graphify, code-review-graph, Understand-Anything, archify and repomix. The long-term ambition is to match or improve their useful features and add new ones, not merely reproduce one tool.

**Why:** The project was chosen after reviewing starred repository-understanding tools. It combines a visible, explorable product with code indexing and graph-assisted retrieval, rather than a standalone chatbot. The requested standard was a useful AI/ML project suitable for a portfolio, with the ambition to be better than the existing tools.

**How implemented:** The product shape is documented in [README.md](README.md). [ROADMAP.md](ROADMAP.md) breaks it into phases; the end-goal section of [PROGRESS.md](PROGRESS.md) records the wider north star and the smaller first-release core. Feature parity and the deployed product remain goals, not completed work.

### 2026-10-09 - Name the project CodeAtlas

**Decision:** Use CodeAtlas as the project and repository name.

**Why:** The name was selected from a shortlist built around exploring and understanding a codebase as a map.

**How implemented:** The public repository is named CodeAtlas, and the project documents use that name. No application branding has been implemented yet.

### 2026-10-09 - Keep model access visitor-owned

**Decision:** Chat uses the visitor's own Gemini API key or their own reachable Ollama endpoint. There is no owner key, shared key, or silent fallback. No-key browsing remains available for parsed maps and source.

**Why:** A default using the project owner's Gemini key was rejected because other visitors would consume that owner's quota. The map should still be explorable without requiring model access.

**How implemented:** The corrected rule is recorded in the model-mode table in [README.md](README.md), the roadmap, and section 6 of [ARCHITECTURE.md](ARCHITECTURE.md). The earlier shared-key idea was rejected, not shipped. Embeddings and chat are planned to use supplied model access; graph-only browsing does not require an LLM. Key handling, model compatibility and safe Ollama connectivity still need implementation and testing. Provider limits and charges apply to the visitor's model access; no-key browsing does not mean hosted infrastructure has no cost.

### 2026-10-09 - Plan the indexing and retrieval stack

**Decision:** Plan a React, Vite and Tailwind frontend, an API server, a queued indexing worker, and self-hosted Supabase with PostgreSQL and pgvector on a free-tier VM. Use tree-sitter for code structure and combine code chunks, embeddings and graph context for answers with `file:line` citations tied to an indexed commit.

**Why:** The map needs extracted code structure, while chat needs relevant code excerpts and relationships. A separate worker keeps indexing out of the interactive request path. The data layer holds repository snapshots, graph data and retrieval indexes.

**How implemented:** [ARCHITECTURE.md](ARCHITECTURE.md) contains the four-piece system, indexing and chat flows, and a data-model sketch. [ROADMAP.md](ROADMAP.md) sets the phased build order: prove a small-repository pipeline, then add the explorable map and deeper retrieval. No schema, worker, API or frontend exists yet. The API framework, graph renderer, exact size caps, embedding choices, endpoint safety and VM capacity remain open decisions. Citation checks are planned; even a valid line reference will not prove an answer's explanation is correct.

### 2026-10-09 - Make the repository public

**Decision:** Create CodeAtlas as a public repository. Accept the two installed applications GitHub attached during creation: Slack + GitHub and ChatGPTBot.

**Why:** Public visibility supports the portfolio goal. The attached applications were explicitly accepted during repository creation; no additional reason for that acceptance was recorded.

**How implemented:** The public repository was created and seeded with [README.md](README.md) and [ROADMAP.md](ROADMAP.md). The source plan and teardown were not published here; the public documents describe the intended product without private hosting details. Application attachment is a repository-creation decision, not an implemented CodeAtlas feature.

### 2026-10-10 - Use living source documents

**Decision:** Keep technical context in ARCHITECTURE.md, actual progress in PROGRESS.md, and UI rules in DESIGN.md, alongside the README and roadmap. PROGRESS.md must state the finished-product goal near the top. Add MEMORY.md to preserve decisions and how they are implemented from beginning to end.

**Why:** The project needs durable context that can be picked up as work continues: what the system should be, what has actually happened, how it should look, and why earlier choices were made.

**How implemented:** ARCHITECTURE.md, PROGRESS.md and DESIGN.md were added on main on 2026-10-10. The end-goal section of PROGRESS.md separates the first-release core from the longer-term feature superset. This file seeds the decision history. Future work should append its real implementation details rather than turning plans into completion claims. README's document list currently links only ROADMAP.md; expanding it is a separate pending change.

### 2026-10-10 - Record the UI and citation design bar

**Decision:** Use a premium dark interface with plain-language copy, restrained effects and deliberate mobile spacing. Make a readable layered map the showpiece. Citations should open the source at the referenced line and highlight the matching map node. Avoid generic AI-design patterns and invented statistics.

**Why:** The interface should help people understand the code rather than overwhelm them with nodes or decoration. Connecting answers to source and the map makes the evidence easier to inspect.

**How implemented:** [DESIGN.md](DESIGN.md) records dark-surface, typography, spacing, motion, map, citation, state and accessibility rules. It covers indexing, empty, no-key, quota, error and excluded-file states. These are documented design rules only: there are no implemented screens, animations or citation interactions yet.

### 2026-10-16 - Add the doc-spine planning documents and set the color palette

**Decision:** Adopt six standard planning documents from the doc-spine template - PRD.md, TRD.md, APP_FLOW.md, UI_UX_BRIEF.md, BACKEND_SCHEMA.md and IMPLEMENTATION_PLAN.md - with unset values marked TBD. Set the UI palette to Dragonfruit #FF4696 (single accent) on Night Violet #1E1033 (base background), with pink text on violet surfaces and violet text on pink fills. Expand the README document list to link every project document.

**Why:** The template documents capture product scope, stack, screens, schema and build phases in fixed fields that can be filled in as decisions land, instead of writing each document from scratch. The palette came from the owner's own reference image. The README list previously linked only ROADMAP.md, and the owner asked for the full list.

**How implemented:** The six documents were published to main on 2026-10-16, one commit per file. [UI_UX_BRIEF.md](UI_UX_BRIEF.md) records the palette with the remaining values as TBD; [DESIGN.md](DESIGN.md) now names the palette in its visual-system section and requires flat fills, no gradients or glow. [README.md](README.md)'s project-documents section links all eleven documents. This supersedes the note in the 2026-10-10 entry that the README linked only ROADMAP.md. All of this is pre-code documentation; nothing is implemented.
