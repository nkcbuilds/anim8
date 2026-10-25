# React Integration

Install the React adapter alongside its runtime dependencies.

```tsx
import { Anim8Player } from "@anim8/react";
import scene from "./scene.json";

export function Diagram() {
  return <Anim8Player scene={scene} />;
}
```

The adapter is SSR-safe: server rendering produces the static SVG frame and client playback is mounted from an effect. React is a peer dependency rather than part of the Anim8 runtime bundle.

For direct controller access, use `useAnim8Player()` and retain the returned controller ref only on the client.
