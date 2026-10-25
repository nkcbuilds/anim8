import { mountPlayer } from "@anim8/player";
import scene from "../reactive/scene.json";

const container = document.querySelector("#player");
const slider = document.querySelector<HTMLInputElement>("#index");
const output = document.querySelector<HTMLOutputElement>("#value");
const eventOutput = document.querySelector<HTMLOutputElement>("#event");

if (!container || !slider || !output || !eventOutput) throw new Error("Example DOM is incomplete.");

const controller = mountPlayer(container, scene as never, {
  onObjectEvent(event) {
    eventOutput.value = `${event.type}:${event.objectId}`;
  },
});
controller.setInput("index", Number(slider.value));

slider.addEventListener("input", () => {
  const index = Number(slider.value);
  output.value = String(index);
  controller.setInput("index", index);
});

window.addEventListener("pagehide", () => controller.destroy(), { once: true });
