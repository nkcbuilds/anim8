import { applyInteractions, evaluate, sceneDuration, type EvaluatedScene, type ScalarValue, type SceneDocument } from "@anim8/core";
import { mountSvg, type SvgMount } from "@anim8/renderer-svg";

export type PlayerObjectEventType =
  | "click"
  | "hover-enter"
  | "hover-leave"
  | "focus"
  | "blur"
  | "activate";

export interface PlayerObjectEvent {
  type: PlayerObjectEventType;
  objectId: string;
  nativeEvent: Event;
}

export interface PlayerOptions {
  autoplay?: boolean;
  loop?: boolean;
  speed?: number;
  reducedMotion?: boolean;
  onFrame?: (frame: EvaluatedScene) => void;
  onObjectEvent?: (event: PlayerObjectEvent) => void;
}

export interface PlayerController {
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  restart(): void;
  reverse(): void;
  setSpeed(speed: number): void;
  setInput(name: string, value: ScalarValue): void;
  dispatch(name: string): void;
  nextStep(): void;
  previousStep(): void;
  getTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  destroy(): void;
}

export function mountPlayer(container: Element, scene: SceneDocument, options: PlayerOptions = {}): PlayerController {
  let time = 0;
  let speed = options.speed ?? 1;
  let playing = false;
  let raf = 0;
  let previousTimestamp: number | null = null;
  const inputs: Record<string, ScalarValue> = {};
  let localState: Record<string, ScalarValue> = { ...(scene.state ?? {}) };
  const duration = sceneDuration(scene);
  const mount: SvgMount = mountSvg(container, evaluate(scene, time, { inputs, state: localState }));
  const objectInteractionKeys = new Set(
    (scene.interactions ?? []).flatMap(interaction =>
      interaction.event.type === "custom"
        ? []
        : [`${interaction.event.type}:${interaction.event.target}`],
    ),
  );
  const customEventNames = new Set(
    (scene.interactions ?? []).flatMap(interaction =>
      interaction.event.type === "custom" ? [interaction.event.name] : [],
    ),
  );
  const handlesObjectEvents = Boolean(options.onObjectEvent) || objectInteractionKeys.size > 0;

  const interactiveTarget = (target: EventTarget | null): Element | null => {
    if (!target || typeof Element === "undefined" || !(target instanceof Element)) return null;
    return target.closest("[data-anim8-id]");
  };

  const prepareInteractiveDom = () => {
    if (!handlesObjectEvents) return;
    container.querySelectorAll("[data-anim8-id]").forEach(element => {
      const objectId = element.getAttribute("data-anim8-id");
      const declarativeTarget = objectId !== null && (
        objectInteractionKeys.has(`click:${objectId}`) ||
        objectInteractionKeys.has(`focus:${objectId}`) ||
        objectInteractionKeys.has(`hover:${objectId}`)
      );
      if ((options.onObjectEvent || declarativeTarget) && !element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "0");
      }
    });
  };

  const emitObjectEvent = (type: PlayerObjectEventType, nativeEvent: Event, target = nativeEvent.target) => {
    const element = interactiveTarget(target);
    const objectId = element?.getAttribute("data-anim8-id");
    if (!objectId) return;

    const declarativeType =
      type === "click" || type === "focus" ? type :
      type === "hover-enter" ? "hover" :
      type === "activate" ? "click" :
      null;

    if (declarativeType && objectInteractionKeys.has(`${declarativeType}:${objectId}`)) {
      localState = applyInteractions(scene, localState, { type: declarativeType, target: objectId });
      render();
    }

    options.onObjectEvent?.({ type, objectId, nativeEvent });
  };

  const clickHandler = (event: Event) => emitObjectEvent("click", event);
  const focusHandler = (event: Event) => emitObjectEvent("focus", event);
  const blurHandler = (event: Event) => emitObjectEvent("blur", event);
  const pointerOverHandler = (event: Event) => {
    const current = interactiveTarget(event.target);
    const related = interactiveTarget((event as PointerEvent).relatedTarget);
    if (current && current !== related) emitObjectEvent("hover-enter", event, current);
  };
  const pointerOutHandler = (event: Event) => {
    const current = interactiveTarget(event.target);
    const related = interactiveTarget((event as PointerEvent).relatedTarget);
    if (current && current !== related) emitObjectEvent("hover-leave", event, current);
  };
  const keyHandler = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== "Enter" && keyboard.key !== " ") return;
    const target = interactiveTarget(keyboard.target);
    if (!target) return;
    keyboard.preventDefault();
    emitObjectEvent("activate", keyboard, target);
  };

  if (handlesObjectEvents) {
    container.addEventListener("click", clickHandler);
    container.addEventListener("focusin", focusHandler);
    container.addEventListener("focusout", blurHandler);
    container.addEventListener("pointerover", pointerOverHandler);
    container.addEventListener("pointerout", pointerOutHandler);
    container.addEventListener("keydown", keyHandler);
  }

  const render = () => {
    const frame = evaluate(scene, time, { inputs, state: localState });
    mount.update(frame);
    prepareInteractiveDom();
    options.onFrame?.(frame);
  };

  prepareInteractiveDom();

  const stopRaf = () => {
    if (raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(raf);
    raf = 0;
    previousTimestamp = null;
  };

  const tick = (timestamp: number) => {
    if (!playing) return;
    if (previousTimestamp === null) previousTimestamp = timestamp;
    const delta = timestamp - previousTimestamp;
    previousTimestamp = timestamp;
    time += delta * speed;

    if (speed >= 0 && time >= duration) {
      if (options.loop && duration > 0) time %= duration;
      else { time = duration; playing = false; }
    } else if (speed < 0 && time <= 0) {
      if (options.loop && duration > 0) time = duration + (time % duration);
      else { time = 0; playing = false; }
    }

    render();
    if (playing) raf = requestAnimationFrame(tick);
  };

  const play = () => {
    if (options.reducedMotion || duration === 0 || playing) return;
    playing = true;
    previousTimestamp = null;
    raf = requestAnimationFrame(tick);
  };

  const pause = () => { playing = false; stopRaf(); };
  const seek = (next: number) => { time = Math.max(0, Math.min(duration, next)); render(); };
  const markerTimes = (scene.markers ?? []).map(m => m.time).sort((a,b) => a-b);

  const controller: PlayerController = {
    play,
    pause,
    seek,
    restart: () => { pause(); seek(0); },
    reverse: () => { speed = speed === 0 ? -1 : -speed; if (!playing) play(); },
    setSpeed: next => { speed = Number.isFinite(next) ? next : speed; },
    setInput: (name, value) => { inputs[name] = value; render(); },
    dispatch: name => {
      if (!customEventNames.has(name)) return;
      localState = applyInteractions(scene, localState, { type: "custom", name });
      render();
    },
    nextStep: () => {
      const next = markerTimes.find(marker => marker > time + 0.001);
      seek(next ?? duration);
    },
    previousStep: () => {
      const previous = [...markerTimes].reverse().find(marker => marker < time - 0.001);
      seek(previous ?? 0);
    },
    getTime: () => time,
    getDuration: () => duration,
    isPlaying: () => playing,
    destroy: () => {
      pause();
      container.removeEventListener("click", clickHandler);
      container.removeEventListener("focusin", focusHandler);
      container.removeEventListener("focusout", blurHandler);
      container.removeEventListener("pointerover", pointerOverHandler);
      container.removeEventListener("pointerout", pointerOutHandler);
      container.removeEventListener("keydown", keyHandler);
      mount.destroy();
    },
  };

  if (options.autoplay) play();
  return controller;
}

const HTMLElementBase: typeof HTMLElement = (globalThis as typeof globalThis & { HTMLElement?: typeof HTMLElement }).HTMLElement ?? (class {} as unknown as typeof HTMLElement);

export class Anim8PlayerElement extends HTMLElementBase {
  #controller: PlayerController | undefined;
  #scene: SceneDocument | undefined;

  set scene(value: SceneDocument | undefined) {
    this.#scene = value;
    this.#mount();
  }

  get scene(): SceneDocument | undefined { return this.#scene; }
  play(): void { this.#controller?.play(); }
  pause(): void { this.#controller?.pause(); }
  seek(timeMs: number): void { this.#controller?.seek(timeMs); }
  restart(): void { this.#controller?.restart(); }
  setSpeed(speed: number): void { this.#controller?.setSpeed(speed); }
  setInput(name: string, value: ScalarValue): void { this.#controller?.setInput(name, value); }
  dispatch(name: string): void { this.#controller?.dispatch(name); }

  disconnectedCallback(): void { this.#controller?.destroy(); }

  async connectedCallback(): Promise<void> {
    if (!this.#scene) {
      const src = this.getAttribute("src");
      if (src && typeof fetch !== "undefined") {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Failed to load Anim8 scene: ${response.status}`);
        this.#scene = await response.json() as SceneDocument;
      }
    }
    this.#mount();
  }

  #mount(): void {
    if (!this.isConnected || !this.#scene) return;
    this.#controller?.destroy();
    this.#controller = mountPlayer(this, this.#scene, {
      autoplay: this.hasAttribute("autoplay"),
      loop: this.hasAttribute("loop"),
      reducedMotion: typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }
}

export function defineAnim8Player(tagName = "anim8-player"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tagName)) customElements.define(tagName, Anim8PlayerElement);
}
