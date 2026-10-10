# CodeAtlas design

Design rules for the app. Source of truth for UI decisions; update it when a rule changes. Nothing here is built yet (see [PROGRESS.md](PROGRESS.md)). Technical context is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Principles

1. **The map is the showpiece.** The first impression is a readable architecture, not a hairball.
2. **Honest by construction.** Show what the system knows, what it inferred and what it could not see. Never invent edges, numbers or claims.
3. **Plain language.** Short sentences, no jargon where a simple word works. Tell the user what happened and what to do next.
4. **Premium and restrained.** A quality dark interface, with few effects and each one purposeful.
5. **Fast and keyboard-first.** `/` or Cmd-K opens search anywhere.

## Visual system

- **Theme:** dark first. Near-black surfaces with a small set of neutral steps; one accent color for selection and primary actions. Light theme is later work.
- **Type:** one clean sans for UI, one monospace for code, paths and line numbers. A clear size scale with few steps. Tabular numbers for counts and line numbers.
- **Spacing:** one spacing scale. Tight, deliberate spacing on mobile; no oversized padding to fill screens.
- **Shape and depth:** consistent radii, hairline borders instead of heavy shadows. Layer by surface color, not by glow.
- **Motion:** short, purposeful transitions (zoom to a node, panel slide). Respect reduced-motion. No decorative animation loops.
- **Color meaning:** color encodes layer or module on the map and confidence on edges. Never use color alone; pair it with shape, label or pattern.

## What to avoid (no AI-slop)

- Gradient-heavy hero sections, glowing orbs, purple-blue default gradients.
- Generic three-card feature grids and stock sparkle icons.
- Made-up stats, fake testimonials, fake user counts, invented benchmarks.
- Marketing filler copy. Every sentence either helps the user act or is removed.
- Walls of nodes. If a view shows too many nodes to read, it is wrong.

## The map

- **Rendering:** canvas-based graph, built to stay smooth on large repos.
- **Layered drill-down:** the top level shows about 8 to 12 modules or layers. Click to open a module into its files, then symbols. Always show where you are (breadcrumb) and how to go back.
- **Readability rules:** label only what fits; show more labels as the user zooms. Group and collapse by default. Cap visible edges and let the user reveal more.
- **Edge honesty:** each edge shows its confidence (EXTRACTED or INFERRED). A filter shows extracted edges only. Uncertain edges are folded away until asked for.
- **Selection:** clicking a node opens a side panel with its source, callers and callees, with the calling line visible.
- **Navigation:** search covers files and symbols. The URL stores map state, the selected node and the open citation, so links reproduce the view.
- **Mobile:** the map is viewable and tappable; panels open as bottom sheets. Details can be simpler than desktop, but never hidden behind hover.

## Chat and citations

- Answers stream in. Citations are chips showing `path:line`, tied to the indexed commit.
- Clicking a citation opens the source viewer at that line and lights up the matching node on the map. Hovering a node in the answer area highlights it too.
- A citation that cannot be verified against the indexed file is shown as unverified, not hidden and not styled as fact.
- Show what the answer used (files and nodes) and note that context may be incomplete.
- Suggested starter questions come from the repo's own structure.

## States

Every screen defines these; none is an afterthought.

| State | Behavior |
|---|---|
| Indexing | Real per-stage progress (cloning, filtering, parsing, graph, embedding) with an honest status. If the stage count or time is unknown, say so; no fake percentage. |
| Empty | Landing with one URL input and a few pre-indexed examples. Empty chat shows starter questions. |
| No key | Calm setup card: chat uses your own model access, free to set up with a direct link, plus the Ollama option. The map stays fully usable. Never framed as an error. |
| Quota hit | Plain message that the user's own key reached its limit, with options (wait, another key, Ollama). |
| Error | Say what failed and what the user can try. Examples: repo too large, unsupported language (map is shallower), endpoint unreachable, repo not found. |
| Excluded files | List files skipped by secret scanning or size caps. |
| Loading | Skeletons that match final layout; no layout shift. |

## Accessibility

- Text and key UI meet WCAG AA contrast on dark surfaces.
- Everything reachable by keyboard; visible focus rings.
- The map has a non-visual alternative: a navigable tree or list of the same modules and files.
- Reduced-motion and screen-reader labels are required, not optional.

## Copy rules

- Plain words, short sentences, active voice.
- Say "planned" for anything not shipped, in docs and in the product.
- No exaggerated claims ("blazing", "revolutionary"). Describe what it does.
- Numbers shown in the product come from real data.
