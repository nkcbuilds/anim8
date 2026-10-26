# Anim8 Studio · Playground

An actual editable scene playground, not a screenshot or static gallery. Run `pnpm build`, then `node examples/playground/server.mjs` and open [http://127.0.0.1:4179](http://127.0.0.1:4179).

Features: editable JSON scenes, pretty-format, 150 sample chooser, bounded compile diagnostics, SVG preview from real Anim8 compiler/evaluator/renderer, absolute-time seeking, play/pause, import JSON, download JSON and current SVG frame. Recompilation happens in a loopback-only Node server with 2 MiB body limit, strict request origin, no arbitrary filesystem routes. External images may be referenced by a trusted scene; do not import untrusted content without host network policy.

This is a local playground, not a deployed collaborative editor, SVG inspector, or keyframe timeline authoring tool. No arbitrary JavaScript execution or generated code compilation is offered.
