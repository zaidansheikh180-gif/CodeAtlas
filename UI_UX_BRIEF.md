# CodeAtlas UI/UX design brief

Status: pre-code. [DESIGN.md](DESIGN.md) is the full rulebook and wins if the two ever disagree. This file is the quick-reference brief in the template format. The color palette below is set by the owner. Fonts and the remaining values are not chosen yet and say TBD rather than guess.

Status labels used in this file: Verified, Chosen, Proposed, Planned, Assumption, TBD, Blocked. Unlabelled content is Planned.

| Field | Content |
|---|---|
| Aesthetic | Premium, restrained, dark first. The map is the showpiece: a readable architecture, never a hairball. Plain language, few effects, each with a purpose. No AI-slop patterns (glowing orbs, default purple-blue gradients, generic three-card grids, sparkle icons, invented stats). |
| Primary Color | Dragonfruit, HEX #FF4696 (pink). The one accent color, used for selection and primary actions. |
| Background Color | Night Violet, HEX #1E1033 (deep violet). Base surface. Extra surface steps (raised panels, borders): TBD, to be derived from this base. |
| Text Color | Dragonfruit #FF4696 on Night Violet surfaces, and Night Violet #1E1033 on Dragonfruit fills (for example buttons), as in the owner's palette reference. Neutral body and secondary text colors: TBD. Must meet WCAG AA contrast; Dragonfruit on Night Violet measures about 5.6:1 (computed), which passes AA for normal text. Long code and body text may need a neutral, TBD. |
| Accent / CTA Color | Dragonfruit #FF4696, same as primary. Night Violet text on it. Color on the map encodes layer or module, and edge confidence; never color alone, always paired with shape, label or pattern. |
| Font | Inter (UI) and JetBrains Mono (code, paths, line numbers), bundled via Fontsource. Chosen in phase 1. Few size steps. Tabular numbers for counts and line numbers. |
| Border Radius | 8px on inputs and buttons, 10-12px on cards and panels. Chosen in phase 1; consistent everywhere. |
| Shadows | Hairline borders instead of heavy shadows. Layer by surface color, not glow. |
| Dark/Light Mode | Dark first. Light theme is later work. |
| Reference Apps | TBD. To be named by the owner. Related tools that inspired the product are listed in the private teardown, not here. |
| Mobile | Tight, deliberate spacing. Map viewable and tappable. Panels as bottom sheets. Nothing hidden behind hover. |

## Experience goals

Status: Proposed. A visitor should reach a readable map of an unfamiliar repo with no setup, then find where a symbol is used and what it affects, and ask a cited question when they bring a model. Observable check: from the landing page, a first-time user opens an example map and reaches a node's source without help.

## Reference analysis

Status: Proposed. The owner has not named reference apps; the Reference Apps field above stays TBD. The inspired tools are studied for qualities, not copied: Archify (standalone, shareable, truthful interaction: focus, upstream and downstream reach), CodeGraph (caller, source, callee view), Graphify (confidence tags on every edge), Understand-Anything (tours and persona-adaptive detail). Sources: their public READMEs, read 2026-10-16. Not inspected: any hosted demo.

## Interaction principles for new views

Impact, tour and export views follow the same rules as the map: keyboard access, no hover-only controls, generated text always labelled, and parsed facts never styled like generated text. Detailed component rules belong in [DESIGN.md](DESIGN.md).

## Key UI patterns

- Canvas graph with layered drill-down (top level about 8 to 12 nodes), breadcrumb, zoom-dependent labels, capped visible edges.
- Edge confidence shown as EXTRACTED or INFERRED, with a filter for extracted only.
- Side panel for source, callers and callees.
- Citation chips (`path:line`) that open the source and light up the map node.
- Search overlay for files and symbols.
- State cards for indexing, empty, no key, quota, error and excluded files.

## Accessibility

- WCAG AA contrast, full keyboard access, visible focus rings.
- Non-visual alternative to the map: a navigable tree or list.
- Reduced-motion and screen-reader labels required.

## Open questions

- Neutral text and surface steps, status colors (error, success), and the map layer colors derived from this palette.
- Fonts, radius and reference apps.
- Light theme timing.
- Owner to name reference apps.
- Look of impact, tour and export views.
