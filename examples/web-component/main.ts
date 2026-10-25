import { defineAnim8WebComponent, type Anim8WebComponent } from "@anim8/web-component";
import scene from "../two-sum/scene.json";

defineAnim8WebComponent();

const player = document.querySelector<Anim8WebComponent>("#demo");
if (!player) throw new Error("Missing anim8-player element.");
player.scene = scene as never;
