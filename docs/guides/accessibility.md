# Accessibility

Anim8 treats animation as an enhancement, not the only way to understand a
scene.

## Reduced motion

The browser player and web component respect `prefers-reduced-motion`.
Playback can still be controlled programmatically, but autoplay/continuous
motion should not be required to understand the content.

## Semantic descriptions

Use object `description` fields for meaning that is not obvious from visible
text:

```ts
{
  id: "db",
  type: "rect",
  text: "DB",
  description: "Primary user database",
  // ...
}
```

## Headless summaries

`@anim8/a11y` converts a scene or evaluated frame into deterministic text and
structured semantics without reading the DOM:

```ts
import { describeScene } from "@anim8/a11y";

const summary = describeScene(scene, {
  time: 750,
  title: "Request lifecycle",
});

console.log(summary.text);
```

The summary can include:

- visible object descriptions/text;
- connector relationships;
- the current named timeline marker;
- scalar state values;
- bounded object lists for large scenes.

Because the summary is computed from scene semantics, it is suitable for SSR,
documentation fallbacks, `aria-describedby` content, export tooling, or other
nonvisual representations.

## Authoring guidance

- Give important objects meaningful text or descriptions.
- Use named steps/markers for multi-stage explanations.
- Do not communicate essential state through color alone.
- Keep player controls keyboard-operable and visibly focused.
- Provide a static or textual alternative for important animated explanations.
- Test with reduced motion and without JavaScript when publishing instructional
  content.


## Framework integrations

React and Vue player components generate a deterministic accessible label from
`@anim8/a11y` by default. Pass an `accessibility` options object to customize
the summary, or `accessibility={false}` to disable generation when the host
application supplies its own accessible name/description. Explicit host
`aria-label` and `role` values take precedence.

The framework-independent web component exposes a visually hidden
`aria-describedby` summary. It refreshes from evaluated frames and current
declarative scalar state as playback or interactions change, without inspecting
rendered SVG geometry.
