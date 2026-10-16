# CodeAtlas

Understand a codebase before you change it.

CodeAtlas is a planned web app that turns a public GitHub repository into an interactive architecture map. Explore files, symbols and dependencies, then ask questions with answers grounded in the actual code and clickable `file:line` citations.

**Status: early planning, pre-code.** This repository documents the intended product. There is no running app or deployed demo yet. Features below are planned, not shipped.

## The experience

1. Paste a public GitHub repository URL or open a pre-indexed example.
2. Follow indexing progress as the worker clones and parses the repository.
3. Explore a layered map, select a node and read its source.
4. Bring your own model to ask questions about the code.
5. Share a read-only map link so someone else can explore without installing anything.

The goal is a readable architecture view, not a wall of nodes. Start with the major modules and drill down to the files and functions behind them.

## Your model, your quota

| Mode | Intended behavior |
| --- | --- |
| No-key map browsing | Explore parsed structure and source without a model key. Graph-only indexing does not need an LLM. |
| BYO Gemini key | Use your own Gemini API key for embeddings and chat. Provider limits and charges apply to your key. |
| Your own Ollama endpoint | Use your own reachable endpoint and compatible chat and embedding models. Localhost on your computer is not reachable from a hosted server without an explicit connection design. |

There is no fallback to the project owner's personal key. A missing key must not silently consume someone else's quota. Saved-key handling, endpoint safety and embedding compatibility will be designed and tested before these modes ship.

## Answers you can inspect

The planned retrieval pipeline combines code chunks with graph context: callers, callees and imports. Answers will link back to the indexed commit, file and line range, with citations checked against that snapshot. A valid line reference is not proof that an AI's explanation is correct; uncertain relationships and incomplete context should remain visible.

## Planned stack

- **Frontend:** React, Vite and Tailwind CSS.
- **Data and auth:** self-hosted Supabase, PostgreSQL and pgvector.
- **Infrastructure:** Free-tier VM target, subject to available resources and measured capacity.
- **Indexing:** a queued worker, shallow clones, code filtering and tree-sitter parsing.
- **Retrieval:** symbol-aware chunks, embeddings and graph-assisted ranking.
- **Models:** caller-supplied Gemini credentials or a caller-controlled Ollama endpoint.

## Build order

- Prove the indexing and citation-chat pipeline on one small repository.
- Add the architecture map and source viewer.
- Improve retrieval, citation checks and model settings.
- Publish a tested demo with shareable maps.
- Add guided tours, impact views, incremental indexing and exports in later releases.

Repository size caps, secret scanning and honest failure states are part of the product, not optional launch polish.

## Project documents

- [Roadmap](ROADMAP.md) - planned build order and releases.
- [Architecture](ARCHITECTURE.md) - source of truth for the system design.
- [Progress](PROGRESS.md) - dated log of what actually happened, plus the end goal.
- [Design](DESIGN.md) - UI and visual design rules.
- [Memory](MEMORY.md) - decision log: what was decided, why, and how it was implemented.
- [Product requirements](PRD.md) - planned product scope, target user and features.
- [Technical requirements](TRD.md) - quick stack lookup; ARCHITECTURE.md owns the design.
- [App flow](APP_FLOW.md) - planned screens and core user journeys.
- [UI/UX brief](UI_UX_BRIEF.md) - quick-reference design brief with the color palette.
- [Backend schema](BACKEND_SCHEMA.md) - planned database schema sketch.
- [Implementation plan](IMPLEMENTATION_PLAN.md) - build phases with done criteria.

CodeAtlas takes inspiration from existing code-graph and repository tools while aiming to build its own interface and workflow. The feature superset is a long-term direction, not a claim of current parity.
