import { describeFrame, describeScene } from "@anim8/a11y";
import type { ScalarValue, SceneDocument } from "@anim8/core";
import { mountPlayer, type PlayerController } from "@anim8/player";

export type PlaybackShortcut =
  | "toggle"
  | "seek-backward"
  | "seek-forward"
  | "restart"
  | "end"
  | null;

const SEEK_STEP_MS = 5_000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const CONTROL_TEMPLATE = `
<style>
  :host {
    display: block;
    color: CanvasText;
    font: 14px/1.4 system-ui, sans-serif;
  }
  .shell {
    display: grid;
    gap: 0.5rem;
  }
  .stage {
    min-height: 1px;
    outline: none;
  }
  .stage:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  button,
  input[type="range"] {
    font: inherit;
  }
  button {
    min-height: 2.25rem;
    padding: 0.35rem 0.6rem;
  }
  button:focus-visible,
  input[type="range"]:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }
  .timeline {
    flex: 1 1 10rem;
    min-width: 8rem;
  }
  .time {
    min-width: 7rem;
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
  .motion-note {
    flex-basis: 100%;
    margin: 0;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
<div class="shell" part="shell">
  <div
    id="stage"
    class="stage"
    part="stage"
    role="region"
    tabindex="0"
    aria-label="Animation. Press Space to play or pause, Left and Right arrows to seek, Home to restart, and End to jump to the end."
    aria-describedby="summary"
  ></div>
  <p id="summary" class="sr-only" part="summary"></p>
  <div class="controls" part="controls" role="group" aria-label="Animation playback controls">
    <button id="previous" part="previous-button" type="button" aria-label="Previous step">Previous</button>
    <button id="play" part="play-button" type="button" aria-label="Play animation" aria-pressed="false">Play</button>
    <button id="restart" part="restart-button" type="button" aria-label="Restart animation">Restart</button>
    <button id="next" part="next-button" type="button" aria-label="Next step">Next</button>
    <input
      id="timeline"
      class="timeline"
      part="timeline"
      type="range"
      min="0"
      max="0"
      step="1"
      value="0"
      aria-label="Animation timeline"
    />
    <output id="time" class="time" part="time" aria-label="Animation time">0:00 / 0:00</output>
    <p id="motion-note" class="motion-note" part="motion-note" role="status" hidden>
      Reduced motion is enabled. Playback is paused; use the timeline or step controls to inspect frames.
    </p>
  </div>
</div>
`;

const HTMLElementBase: typeof HTMLElement =
  (globalThis as typeof globalThis & { HTMLElement?: typeof HTMLElement }).HTMLElement ??
  (class {} as unknown as typeof HTMLElement);

export function playbackShortcutForKey(key: string): PlaybackShortcut {
  switch (key) {
    case " ":
    case "Spacebar":
      return "toggle";
    case "ArrowLeft":
      return "seek-backward";
    case "ArrowRight":
      return "seek-forward";
    case "Home":
      return "restart";
    case "End":
      return "end";
    default:
      return null;
  }
}

function formatTime(timeMs: number): string {
  const seconds = Math.max(0, Math.round(timeMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export class Anim8WebComponent extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ["autoplay", "loop", "src"];
  }

  #scene: SceneDocument | undefined;
  #controller: PlayerController | undefined;
  #stage: HTMLElement | undefined;
  #playButton: HTMLButtonElement | undefined;
  #previousButton: HTMLButtonElement | undefined;
  #nextButton: HTMLButtonElement | undefined;
  #restartButton: HTMLButtonElement | undefined;
  #timeline: HTMLInputElement | undefined;
  #timeOutput: HTMLOutputElement | undefined;
  #motionNote: HTMLElement | undefined;
  #summary: HTMLElement | undefined;
  #motionQuery: MediaQueryList | undefined;
  #reducedMotion = false;
  #domBound = false;
  #loadSerial = 0;
  #loadAbort: AbortController | undefined;

  constructor() {
    super();
    const attachShadow = (this as HTMLElement).attachShadow;
    if (typeof attachShadow !== "function") return;
    const root = attachShadow.call(this, { mode: "open" });
    root.innerHTML = CONTROL_TEMPLATE;
  }

  set scene(value: SceneDocument | undefined) {
    this.#loadSerial += 1;
    this.#loadAbort?.abort();
    this.#scene = value;
    this.#mount(false, false);
  }

  get scene(): SceneDocument | undefined {
    return this.#scene;
  }

  play(): void {
    if (this.#reducedMotion) return;
    this.#controller?.play();
    this.#syncControls();
  }

  pause(): void {
    this.#controller?.pause();
    this.#syncControls();
  }

  seek(timeMs: number): void {
    this.#controller?.seek(timeMs);
    this.#syncControls();
  }

  restart(): void {
    this.#controller?.restart();
    this.#syncControls();
  }

  nextStep(): void {
    this.#controller?.nextStep();
    this.#syncControls();
  }

  previousStep(): void {
    this.#controller?.previousStep();
    this.#syncControls();
  }

  setSpeed(speed: number): void {
    this.#controller?.setSpeed(speed);
  }

  setInput(name: string, value: ScalarValue): void {
    this.#controller?.setInput(name, value);
  }

  connectedCallback(): void {
    if (!this.#bindDom()) return;
    this.#installReducedMotionListener();

    if (this.#scene) {
      this.#mount(false, true);
      return;
    }

    const src = this.getAttribute("src");
    if (src) void this.#loadScene(src);
    else this.#syncControls();
  }

  disconnectedCallback(): void {
    this.#controller?.destroy();
    this.#controller = undefined;
    this.#loadAbort?.abort();
    this.#loadAbort = undefined;
    this.#removeReducedMotionListener();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.isConnected) return;

    if (name === "src") {
      if (newValue) void this.#loadScene(newValue);
      return;
    }

    if (!this.#controller) return;

    if (name === "autoplay") {
      if (newValue !== null) this.play();
      else this.pause();
      return;
    }

    if (name === "loop") {
      this.#mount(true, false);
    }
  }

  #bindDom(): boolean {
    if (this.#domBound) return true;
    const root = this.shadowRoot;
    if (!root) return false;

    const stage = root.getElementById("stage");
    const play = root.getElementById("play");
    const previous = root.getElementById("previous");
    const next = root.getElementById("next");
    const restart = root.getElementById("restart");
    const timeline = root.getElementById("timeline");
    const time = root.getElementById("time");
    const motionNote = root.getElementById("motion-note");
    const summary = root.getElementById("summary");

    if (
      !(stage instanceof HTMLElement) ||
      !(play instanceof HTMLButtonElement) ||
      !(previous instanceof HTMLButtonElement) ||
      !(next instanceof HTMLButtonElement) ||
      !(restart instanceof HTMLButtonElement) ||
      !(timeline instanceof HTMLInputElement) ||
      !(time instanceof HTMLOutputElement) ||
      !(motionNote instanceof HTMLElement) ||
      !(summary instanceof HTMLElement)
    ) {
      return false;
    }

    this.#stage = stage;
    this.#playButton = play;
    this.#previousButton = previous;
    this.#nextButton = next;
    this.#restartButton = restart;
    this.#timeline = timeline;
    this.#timeOutput = time;
    this.#motionNote = motionNote;
    this.#summary = summary;

    play.addEventListener("click", () => this.#togglePlayback());
    previous.addEventListener("click", () => this.previousStep());
    next.addEventListener("click", () => this.nextStep());
    restart.addEventListener("click", () => this.restart());
    timeline.addEventListener("input", () => this.seek(Number(timeline.value)));
    stage.addEventListener("keydown", event => this.#handleStageKeydown(event));

    this.#domBound = true;
    return true;
  }

  #handleStageKeydown(event: KeyboardEvent): void {
    const shortcut = playbackShortcutForKey(event.key);
    if (!shortcut) return;

    event.preventDefault();

    switch (shortcut) {
      case "toggle":
        this.#togglePlayback();
        break;
      case "seek-backward":
        this.seek((this.#controller?.getTime() ?? 0) - SEEK_STEP_MS);
        break;
      case "seek-forward":
        this.seek((this.#controller?.getTime() ?? 0) + SEEK_STEP_MS);
        break;
      case "restart":
        this.restart();
        break;
      case "end":
        this.seek(this.#controller?.getDuration() ?? 0);
        break;
    }
  }

  #togglePlayback(): void {
    if (!this.#controller || this.#reducedMotion) return;
    if (this.#controller.isPlaying()) this.pause();
    else this.play();
  }

  #mount(preserveTime: boolean, allowAutoplay: boolean): void {
    if (!this.isConnected || !this.#scene || !this.#stage) return;

    const previousTime = preserveTime ? (this.#controller?.getTime() ?? 0) : 0;
    this.#controller?.destroy();

    this.#controller = mountPlayer(this.#stage, this.#scene, {
      autoplay: allowAutoplay && this.hasAttribute("autoplay") && !this.#reducedMotion,
      loop: this.hasAttribute("loop"),
      reducedMotion: this.#reducedMotion,
      onFrame: frame => {
        this.#syncControls(frame.time, frame.duration);
        this.#syncAccessibility(frame);
        this.#dispatchFrame(frame.time, frame.duration);
      },
    });

    if (preserveTime && previousTime > 0) {
      this.#controller.seek(previousTime);
    }

    this.#syncControls();
    this.#syncAccessibility();
  }

  #syncAccessibility(frame?: Parameters<typeof describeFrame>[0]): void {
    if (!this.#scene || !this.#summary) return;
    const summary = frame
      ? describeFrame(frame, {
          source: this.#scene,
          state: { ...(this.#controller?.getState() ?? {}) },
        })
      : describeScene(this.#scene);
    if (this.#summary.textContent !== summary.text) this.#summary.textContent = summary.text;
  }

  #syncControls(frameTime?: number, frameDuration?: number): void {
    const duration = frameDuration ?? this.#controller?.getDuration() ?? 0;
    const time = frameTime ?? this.#controller?.getTime() ?? 0;
    const playing = this.#controller?.isPlaying() ?? false;

    if (this.#playButton) {
      this.#playButton.textContent = playing ? "Pause" : "Play";
      this.#playButton.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
      this.#playButton.setAttribute("aria-pressed", playing ? "true" : "false");
      this.#playButton.disabled = this.#reducedMotion || duration === 0;
    }

    if (this.#timeline) {
      this.#timeline.max = String(Math.max(0, duration));
      this.#timeline.value = String(Math.max(0, Math.min(duration, time)));
      this.#timeline.disabled = duration === 0;
    }

    const disableStepping = duration === 0;
    if (this.#previousButton) this.#previousButton.disabled = disableStepping;
    if (this.#nextButton) this.#nextButton.disabled = disableStepping;
    if (this.#restartButton) this.#restartButton.disabled = disableStepping;

    if (this.#timeOutput) {
      this.#timeOutput.value = `${formatTime(time)} / ${formatTime(duration)}`;
    }

    if (this.#motionNote) {
      this.#motionNote.hidden = !this.#reducedMotion;
    }
  }

  #installReducedMotionListener(): void {
    this.#removeReducedMotionListener();

    if (typeof matchMedia !== "function") {
      this.#reducedMotion = false;
      this.#syncControls();
      return;
    }

    const query = matchMedia(REDUCED_MOTION_QUERY);
    this.#motionQuery = query;
    this.#reducedMotion = query.matches;
    query.addEventListener("change", this.#onReducedMotionChange);
    this.#syncControls();
  }

  #removeReducedMotionListener(): void {
    this.#motionQuery?.removeEventListener("change", this.#onReducedMotionChange);
    this.#motionQuery = undefined;
  }

  #onReducedMotionChange = (event: MediaQueryListEvent): void => {
    if (event.matches === this.#reducedMotion) return;
    this.#reducedMotion = event.matches;

    if (this.#controller) {
      this.#mount(true, false);
    } else {
      this.#syncControls();
    }
  };

  async #loadScene(src: string): Promise<void> {
    if (typeof fetch !== "function") return;

    const serial = ++this.#loadSerial;
    this.#loadAbort?.abort();
    const abort = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    this.#loadAbort = abort;

    try {
      const response = await fetch(src, abort ? { signal: abort.signal } : undefined);
      if (!response.ok) {
        throw new Error(`Failed to load Anim8 scene: ${response.status}`);
      }

      const scene = await response.json() as SceneDocument;
      if (serial !== this.#loadSerial) return;

      this.#scene = scene;
      this.#mount(false, true);
    } catch (error) {
      if (abort?.signal.aborted || serial !== this.#loadSerial) return;
      this.dispatchEvent(new CustomEvent("anim8-error", { detail: error }));
    }
  }

  #dispatchFrame(time: number, duration: number): void {
    if (typeof CustomEvent === "undefined") return;
    this.dispatchEvent(new CustomEvent("anim8-frame", {
      detail: { time, duration },
    }));
  }
}

/**
 * Explicit, SSR-safe registration. Importing this package never registers a
 * custom element or touches the CustomElementRegistry.
 */
export function defineAnim8WebComponent(tagName = "anim8-player"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tagName)) {
    customElements.define(tagName, Anim8WebComponent);
  }
}
