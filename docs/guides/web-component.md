# Web Component

The framework-independent player wrapper is explicitly registered:

```ts
import { defineAnim8WebComponent } from "@anim8/web-component";

defineAnim8WebComponent();
```

Then:

```html
<anim8-player src="/animations/two-sum.json"></anim8-player>
```

The component provides native playback buttons, a timeline slider, keyboard shortcuts, reduced-motion handling, and methods that proxy the underlying player controller.

Importing the package is SSR-safe and does not register the custom element automatically.
