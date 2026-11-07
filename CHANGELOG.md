# Changelog

All notable public changes to Anim8 are recorded here. Anim8 follows synchronized
package versions across the `@anim8/*` workspace.

## Unreleased

### Added

- Hand-drawn theme overhaul: rough.js-style bowed double strokes, continuous
  rounded rectangles, overshooting ellipses, drawn arrowheads, outline-following
  fills, wrapped labels, and the bundled OFL Virgil font embedded in sketch SVGs
  (`font: "reference"` opts out).
- `connectorGeometry`: centre-anchored connectors now bind to shape outlines with
  a 6px gap, so arrowheads are visible in both renderers.
- Role-based diagram palette (`DIAGRAM_TONES`, `DIAGRAM_ROLES`), deterministic
  text fitting (`fitText`), and `lintDesign` for layout and colour discipline.
- Visual style guide for authors and agents (`docs/guides/visual-style.md`).
- 17 animated diagram families with runtime/design checks and an offline,
  replayable gallery. Draw actions evaluate on every supported shape, line and
  connector, with deterministic seeking.
- `anim8 render`, `@anim8/export`, the catalog gallery and the playground pick
  the renderer from `scene.theme`.
- The 150-scene catalog now uses the sketch theme with role colours, progressive
  reveal, a travelling token, and re-spaced layouts that pass `lintDesign`.

- Deterministic, serializable state machines with bounded scalar guards/actions.
- Obstacle-aware routed connectors using bounded world-space geometry.
- React, Vue, and web-component accessibility summaries.
- Explicit scene-schema migration API for future version evolution.
- Real Chromium, Firefox, and WebKit browser qualification.
- Next.js and Astro downstream consumer builds.
- Optional Dagre and ELK layouts, technical presets, sketch rendering, and
  deterministic compatible SVG path morphing.

### Release process

Release tags use the form `vX.Y.Z` and must exactly match every publishable
`@anim8/*` package version. The release workflow reruns package, consumer, and
browser qualification before publishing with npm provenance.
