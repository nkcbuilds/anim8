# SSR and Static Rendering

The core, compiler, authoring helpers, static SVG renderer, player package, React adapter, Vue adapter, and web-component registration module are designed to import without browser globals.

## Static SVG

```ts
import { renderSceneAt } from "@anim8/renderer-svg";

const svg = renderSceneAt(scene, 0);
```

This path does not need `window` or `document`.

## Framework hydration

React and Vue adapters render a static initial SVG on the server and mount the interactive player on the client.

The web component uses explicit registration so importing it during SSR does not mutate global custom-element state.

## Stable identity

Object IDs are scene data and remain stable across server/static and client evaluation. Browser mounting uses keyed SVG records rather than replacing the whole SVG on every normal frame.

## Consumer verification

`tests/consumers` copies built package outputs into an isolated temporary `node_modules` and smoke-tests Vanilla ESM, Node SSR import, and React SSR across real package boundaries. Optional Next.js/Astro source fixtures are explicitly skipped when their framework dependencies are not installed.
