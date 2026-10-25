# Vanilla JavaScript

Anim8 does not require a framework.

```ts
import { mountPlayer } from "@anim8/player";
import scene from "./scene.json";

const host = document.querySelector("#diagram");
if (!host) throw new Error("Missing diagram host");

const player = mountPlayer(host, scene);

player.play();
player.seek(500);
player.setSpeed(1.5);
player.setInput("index", 3);
```

Destroy the controller when the host is removed:

```ts
player.destroy();
```

For a no-controller embed, use the accessible `@anim8/web-component` wrapper.
