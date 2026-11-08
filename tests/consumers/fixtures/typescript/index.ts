import { scene } from "@anim8/authoring";
import { compileJson } from "@anim8/compiler";
import { evaluate, type SceneDocument } from "@anim8/core";
import { describeScene } from "@anim8/a11y";
import { mountPlayer, type PlayerOptions } from "@anim8/player";
import { renderSvg } from "@anim8/renderer-svg";
import { renderSketchSvg } from "@anim8/renderer-sketch";
import { Anim8Player as ReactPlayer, type Anim8PlayerProps } from "@anim8/react";
import { Anim8Player as VuePlayer, useAnim8Player } from "@anim8/vue";
import { createElement } from "react";
import { h, ref } from "vue";

const builder = scene({ fontFamily: '"My Font", sans-serif' });
const request = builder.box("Request", { id: "request", x: 120, y: 100 });
builder.sequence(request.moveTo({ x: 300, y: 100 }, { duration: 900 }));
const document: SceneDocument = builder.toJSON();
const result = compileJson(JSON.stringify(document));
if (!result.ok || !result.scene) throw new Error("Invalid scene");

const options: PlayerOptions = {
  onFrame(frame) { const time: number = frame.time; void time; },
  onObjectEvent(event) { const id: string = event.objectId; void id; },
};
const controller = mountPlayer(globalThis.document.createElement("div"), result.scene, options);
controller.seek(450);
controller.destroy();
const frame = evaluate(result.scene, 450);
const svg: string = renderSvg(frame);
const sketch: string = renderSketchSvg(frame);
describeScene(result.scene);
const props: Anim8PlayerProps = { scene: result.scene, options };
createElement(ReactPlayer, props);
h(VuePlayer, { scene: result.scene, options });
useAnim8Player(ref(document), options);
void [svg, sketch];

// Keep a negative assertion so a loss of public typing cannot silently pass.
// @ts-expect-error seek requires a numeric timestamp
controller.seek("450");
