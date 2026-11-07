import { applySceneEvent, evaluate, initializeStateMachines, sceneDuration, type EvaluatedScene, type ScalarValue, type SceneDocument } from "@anim8/core";
import { mountSvg, renderSvg, type SvgMount } from "@anim8/renderer-svg";
import { mountSketchSvg, renderSketchMarkup } from "@anim8/renderer-sketch/live";
import { readSceneResponse } from "../../../internal/scene-source.js";

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
  /** Replace the imperative object callback without resetting time or scene state. */
  setObjectEventHandler(handler: PlayerOptions["onObjectEvent"]): void;
  dispatch(name: string): void;
  nextStep(): void;
  previousStep(): void;
  getTime(): number;
  getDuration(): number;
  getState(): Readonly<Record<string, ScalarValue>>;
  getMachineState(id: string): string | undefined;
  isPlaying(): boolean;
  destroy(): void;
}

export function mountPlayer(container: Element, scene: SceneDocument, options: PlayerOptions = {}): PlayerController {
  let time = 0;
  let speed = options.speed !== undefined && Number.isFinite(options.speed) ? options.speed : 1;
  let destroyed = false;
  let playing = false;
  let raf = 0;
  let previousTimestamp: number | null = null;
  const ownerDocument = container.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  const inputs: Record<string, ScalarValue> = Object.create(null);
  let localState: Record<string, ScalarValue> = { ...(scene.state ?? {}) };
  let localMachines = initializeStateMachines(scene);
  const duration = sceneDuration(scene);
  const mount: SvgMount = mountFrame(container, evaluate(scene, time, { inputs, state: localState }));
  const machineTransitions = (scene.stateMachines ?? []).flatMap(machine =>
    machine.states.flatMap(state => state.transitions),
  );
  const declarativeEvents = [
    ...(scene.interactions ?? []).map(interaction => interaction.event),
    ...machineTransitions.map(transition => transition.event),
  ];
  const objectInteractionKeys = new Set(
    declarativeEvents.flatMap(event =>
      event.type === "custom"
        ? []
        : [`${event.type}:${event.target}`],
    ),
  );
  const customEventNames = new Set(
    declarativeEvents.flatMap(event =>
      event.type === "custom" ? [event.name] : [],
    ),
  );
  let objectEventHandler = options.onObjectEvent;
  let objectEventsBound = false;
  const generatedTabIndices = new Set<Element>();

  const interactiveTarget = (target: EventTarget | null): Element | null => {
    if (!target || typeof Element === "undefined" || !(target instanceof Element)) return null;
    return target.closest("[data-anim8-id]");
  };

  const prepareInteractiveDom = () => {
    if (!objectEventHandler && !objectInteractionKeys.size && !generatedTabIndices.size) return;
    const elements = container.querySelectorAll("[data-anim8-id]");
    const live = new Set(Array.from(elements));
    for (const element of generatedTabIndices) if (!live.has(element)) generatedTabIndices.delete(element);
    elements.forEach(element => {
      const objectId = element.getAttribute("data-anim8-id");
      const declarativeTarget = objectId !== null && (
        objectInteractionKeys.has(`click:${objectId}`) ||
        objectInteractionKeys.has(`focus:${objectId}`) ||
        objectInteractionKeys.has(`hover:${objectId}`)
      );
      if (objectEventHandler || declarativeTarget) {
        if (element.hasAttribute("tabindex")) return;
        element.setAttribute("tabindex", "0");
        generatedTabIndices.add(element);
      } else if (generatedTabIndices.delete(element) && element.getAttribute("tabindex") === "0") {
        element.removeAttribute("tabindex");
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
      const result = applySceneEvent(scene, localState, localMachines, { type: declarativeType, target: objectId });
      localState = result.state;
      localMachines = result.machines;
      render();
    }

    objectEventHandler?.({ type, objectId, nativeEvent });
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

  const objectListeners = [["click", clickHandler], ["focusin", focusHandler], ["focusout", blurHandler],
    ["pointerover", pointerOverHandler], ["pointerout", pointerOutHandler], ["keydown", keyHandler]] as const;
  const syncObjectEvents = () => {
    const needed = Boolean(objectEventHandler) || objectInteractionKeys.size > 0;
    if (needed === objectEventsBound) return;
    for (const [type, listener] of objectListeners) {
      if (needed) container.addEventListener(type, listener);
      else container.removeEventListener(type, listener);
    }
    objectEventsBound = needed;
  };
  syncObjectEvents();

  const render = () => {
    if (destroyed) return;
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
    raf = 0;
    if (destroyed || !playing) return;
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

    try { render(); }
    catch (error) { playing = false; stopRaf(); throw error; }
    if (playing && !raf && !ownerDocument?.hidden && typeof requestAnimationFrame !== "undefined") {
      raf = requestAnimationFrame(tick);
    }
  };

  const play = () => {
    if (destroyed || options.reducedMotion || duration === 0 || playing) return;
    playing = true;
    previousTimestamp = null;
    if (!ownerDocument?.hidden && typeof requestAnimationFrame !== "undefined") {
      raf = requestAnimationFrame(tick);
    }
  };

  const pause = () => { playing = false; stopRaf(); };

  const visibilityHandler = () => {
    if (!playing) return;
    if (ownerDocument?.hidden) {
      // Preserve the exact current timeline time and discard wall-clock time
      // spent hidden. Resuming starts with a fresh RAF timestamp.
      stopRaf();
      return;
    }
    previousTimestamp = null;
    if (!raf && typeof requestAnimationFrame !== "undefined") {
      raf = requestAnimationFrame(tick);
    }
  };
  ownerDocument?.addEventListener?.("visibilitychange", visibilityHandler);
  const seek = (next: number) => {
    if (destroyed || !Number.isFinite(next)) return;
    time = Math.max(0, Math.min(duration, next));
    render();
  };
  const markerTimes = (scene.markers ?? []).map(m => m.time).sort((a,b) => a-b);

  const controller: PlayerController = {
    play,
    pause,
    seek,
    restart: () => { pause(); seek(0); },
    reverse: () => { speed = speed === 0 ? -1 : -speed; if (!playing) play(); },
    setSpeed: next => { speed = Number.isFinite(next) ? next : speed; },
    setInput: (name, value) => { inputs[name] = value; render(); },
    setObjectEventHandler: handler => {
      if (destroyed) return;
      objectEventHandler = handler;
      syncObjectEvents();
      prepareInteractiveDom();
    },
    dispatch: name => {
      if (!customEventNames.has(name)) return;
      const result = applySceneEvent(scene, localState, localMachines, { type: "custom", name });
      localState = result.state;
      localMachines = result.machines;
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
    getState: () => ({ ...localState }),
    getMachineState: id => localMachines[id],
    isPlaying: () => playing,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      pause();
      container.removeEventListener("click", clickHandler);
      container.removeEventListener("focusin", focusHandler);
      container.removeEventListener("focusout", blurHandler);
      container.removeEventListener("pointerover", pointerOverHandler);
      container.removeEventListener("pointerout", pointerOutHandler);
      container.removeEventListener("keydown", keyHandler);
      ownerDocument?.removeEventListener?.("visibilitychange", visibilityHandler);
      mount.destroy();
    },
  };

  if (options.autoplay) play();
  return controller;
}

const HTMLElementBase: typeof HTMLElement = (globalThis as typeof globalThis & { HTMLElement?: typeof HTMLElement }).HTMLElement ?? (class {} as unknown as typeof HTMLElement);

export class Anim8PlayerElement extends HTMLElementBase {
  static get observedAttributes(): string[] { return ["src"]; }
  #controller: PlayerController | undefined;
  #scene: SceneDocument | undefined;
  #loadSerial = 0;
  #loadAbort: AbortController | undefined;
  #sourceToLoad: string | undefined;

  set scene(value: SceneDocument | undefined) {
    this.#sourceToLoad = undefined;
    this.#loadSerial++;
    this.#loadAbort?.abort();
    this.#scene = value;
    if (!value) {
      this.#controller?.destroy();
      this.#controller = undefined;
      return;
    }
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
  getState(): Readonly<Record<string, ScalarValue>> { return this.#controller?.getState() ?? {}; }
  getMachineState(id: string): string | undefined { return this.#controller?.getMachineState(id); }

  disconnectedCallback(): void {
    this.#loadSerial++;
    this.#loadAbort?.abort();
    this.#controller?.destroy(); this.#controller = undefined;
  }

  async connectedCallback(): Promise<void> {
    if (!this.#scene || this.#sourceToLoad) {
      const src = this.getAttribute("src");
      if (src && typeof fetch !== "undefined") {
        await this.#loadScene(src);
        return;
      }
    }
    this.#mount();
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (name !== "src" || previous === next) return;
    this.#loadSerial++;
    this.#loadAbort?.abort();
    this.#sourceToLoad = next ?? undefined;
    if (next && this.isConnected) void this.#loadScene(next);
  }

  async #loadScene(src: string): Promise<void> {
    this.#sourceToLoad = src;
    if (typeof fetch === "undefined") return;
    const serial = ++this.#loadSerial;
    this.#loadAbort?.abort();
    const abort = new AbortController();
    this.#loadAbort = abort;
    try {
      const loaded = await readSceneResponse(await fetch(src, { signal: abort.signal }));
      if (serial !== this.#loadSerial || !this.isConnected || this.getAttribute("src") !== src) return;
      this.#scene = loaded;
      this.#sourceToLoad = undefined;
      this.#mount();
    } catch (error) {
      if (abort.signal.aborted || serial !== this.#loadSerial) return;
      this.dispatchEvent(new CustomEvent("anim8-error", { detail: error }));
    }
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

/**
 * Mount the renderer a scene's theme asks for: hand-drawn for "sketch",
 * geometric otherwise. Both update incrementally and adopt matching
 * server-rendered markup from `renderSceneMarkup`.
 */
export function mountFrame(container: Element, frame: EvaluatedScene): SvgMount {
  return frame.scene.theme === "sketch" ? mountSketchSvg(container, frame) : mountSvg(container, frame);
}

/**
 * Static SVG for a frame, using the renderer its scene theme asks for. Sketch
 * markup names the hand-drawn font without embedding it; a mounted player
 * loads the font. For standalone files use `renderSketchSvg` from
 * `@anim8/renderer-sketch`, which embeds it.
 */
export function renderFrameMarkup(frame: EvaluatedScene): string {
  return frame.scene.theme === "sketch" ? renderSketchMarkup(frame) : renderSvg(frame);
}

/** Static SVG for a scene at a time (SSR, no-JS fallbacks), matching what mountPlayer shows. */
export function renderSceneMarkup(scene: SceneDocument, timeMs: number): string {
  return renderFrameMarkup(evaluate(scene, timeMs));
}
