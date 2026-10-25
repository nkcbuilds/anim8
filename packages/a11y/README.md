# @anim8/a11y

Deterministic, headless accessibility summaries for Anim8 scenes and evaluated frames.

This optional package converts scene semantics into concise text that framework
wrappers, web components, documentation sites, or exporters can expose as an
alternative to motion.

```ts
import { describeScene } from "@anim8/a11y";

const summary = describeScene(scene, { time: 750 });
console.log(summary.text);
```

The package does not inspect the DOM and does not use AI. Given the same scene,
time, state, and options it produces the same structured summary.

It reports visible object descriptions/text, connector relationships, the
current named marker/step when source timeline metadata is available, and an
optional scalar state summary.
