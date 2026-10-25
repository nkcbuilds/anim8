# Vue 3 Integration

`@anim8/vue` is a thin SSR-safe adapter around the shared Anim8 player.

```vue
<script setup lang="ts">
import { Anim8Player } from "@anim8/vue";
import scene from "./scene.json";
</script>

<template>
  <Anim8Player :scene="scene" />
</template>
```

Vue is a peer dependency. Server rendering emits a static SVG initial frame; interactive playback is mounted only on the client.

Use `useAnim8Player()` when application code needs the underlying controller.
