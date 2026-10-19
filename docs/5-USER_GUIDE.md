# CodeAtlas user guide

Reference for the features behind the buttons: query syntax, the graph schema, languages, exports, watch mode and performance. Record shapes live in `src/lib/types.ts`; this page summarizes them.

## Graph query syntax and examples

Graph Query Mode is key-free and deterministic: the question is parsed into an intent, candidate nodes are ranked by name match, and the answer comes from graph traversal, not a model.

| You ask | Intent | Example |
| --- | --- | --- |
| What does X import? | `imports` | "what imports graphquery.ts" |
| What imports X? | `dependents` | "what depends on db.ts" |
| Who calls X? | `callers` | "callers of buildGraph" |
| What does X call? | `callees` | "what does runPipeline call" |
| What breaks if X changes? | `impact` | "impact of changing pipeline.ts" |
| How does A reach B? | `path` | "shortest path from App.tsx to secrets.ts" |
| What is X? | `explain` | "explain the secrets module" |
| What is in X? | `structure` | "file structure of src/lib" |

Tips: name the file, symbol or module the way it appears in the repo; the resolver ranks close matches and shows which node it picked. Every answer carries `file:line` citations that open the source viewer at that line and highlight the node on the map. Semantic questions ("why is auth designed this way") get an honest needs-model-key answer rather than a guess.

## Graph schema

- **Nodes:** repositories, modules (directory-level clusters), files and symbols (`function`, `class`, `method`).
- **Edges:** `imports`, `calls`, `contains`. Every edge is tagged `extracted` (found by the parser) or `inferred` (heuristic, e.g. by naming convention) and can be filtered on that tag.
- **Storage:** repos, files, symbols, edges, jobs, chunks, conversations and messages are IndexedDB records keyed per repo; communities and other analytics stores, settings, snapshots, feedback and the semantic-extraction stores (semanticRuns, semanticEdges) live alongside them. Modules are computed from the graph on the fly, and diagnostics run on demand without being persisted. Full shapes: `src/lib/types.ts`.
- **Provenance:** every repo record pins the commit (or local manifest) it was indexed from; citations resolve against that snapshot.

## Supported languages

- **Full parsing (symbols, imports, calls):** JavaScript/JSX, TypeScript/TSX, Python. Parsed with tree-sitter compiled to WASM in a Web Worker.
- **Listed but not parsed:** everything else appears as file and module nodes (including Markdown and docs files) so structure, search and module maps still work.

## Export and import formats

- **Graph JSON (export and import):** full-fidelity graph with metadata; filtered subsets supported. Imports are validated client-side with size guards and ID remapping, and land as a separate imported repo.
- **Mermaid:** module map (`flowchart LR` with typed edges and per-edge counts) and call-flow diagrams.
- **GraphML:** module map with escaped names and typed data keys, for tools like yEd or Gephi.
- **PNG:** snapshot of the live map canvas.
- **Reports:** diagnostics, compare/merge results, feedback and lessons documents export as JSON and/or Markdown.

Mermaid import is intentionally not supported; the JSON path carries full fidelity.

## Graphify compatibility

The JSON export covers the same conceptual model (nodes, typed edges, EXTRACTED/INFERRED confidence) but is CodeAtlas's own schema, not a byte-compatible Graphify file. Direct Graphify-format import is deferred until a real Graphify sample file is available to match against (tracked in FEATURE_PACK_PLAN.md open questions).

## Model providers

No built feature requires a model key. The optional model layer (live since 2026-10-17) supports exactly two providers, both called directly from your browser with nothing in between: **Gemini** (your own API key, held in memory or, if you opt in, this browser's localStorage) and **Ollama** (an endpoint you control). With one configured you get semantic edge extraction (INFERRED-labelled findings) and model chat with graph-first retrieval. Every key-free feature works without a provider.

## Local-folder watch mode

Open a folder with the File System Access API (Chromium-only) to index it entirely on-device. Watch mode then polls the folder with a quiet-period debounce, confirms changes by content hash (add, modify, delete, rename), and applies incremental updates through the same pipeline as a full index. Pause, resume or stop from the watch panel. If the browser parks the folder permission, the panel says so and offers a re-grant. Handles and manifests persist locally so a re-opened session can resume watching.

## Performance recommendations

- Performance mode turns on automatically for large graphs (fewer layout ticks, no minimap, label caps) and can be forced on or off in the Status panel.
- Traversal-heavy answers (impact, paths) carry budgets; when an answer is truncated it says so instead of pretending completeness.
- For repos near the size caps, index the ref you actually need (a branch or tag, not every branch) or work from a local folder and let incremental indexing do the rest.
- The Status panel shows indexing throughput (files/s) and query latency so you can tell a slow network from a slow graph.
