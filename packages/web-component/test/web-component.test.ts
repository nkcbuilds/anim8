import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStyle, defaultTransform, type SceneDocument } from "@anim8/core";

class FakeShadowRoot {
  innerHTML = "";
  readonly elements = new Map<string, FakeHTMLElement>();

  getElementById(id: string): FakeHTMLElement | null {
    return this.elements.get(id) ?? null;
  }
}

class FakeHTMLElement {
  shadowRoot: FakeShadowRoot | null = null;
  isConnected = true;
  hidden = false;
  textContent = "";
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: any) => void>>();

  attachShadow(): FakeShadowRoot {
    const root = new FakeShadowRoot();
    this.shadowRoot = root;
    return root;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(): boolean {
    return true;
  }
}

class FakeButtonElement extends FakeHTMLElement {
  disabled = false;
}

class FakeInputElement extends FakeHTMLElement {
  value = "0";
  max = "0";
  disabled = false;
}

class FakeOutputElement extends FakeHTMLElement {
  value = "";
}

interface FakeRegistry {
  definitions: Map<string, CustomElementConstructor>;
  define(name: string, ctor: CustomElementConstructor): void;
  get(name: string): CustomElementConstructor | undefined;
}

function registry(): FakeRegistry {
  const definitions = new Map<string, CustomElementConstructor>();
  return {
    definitions,
    define(name, ctor) {
      definitions.set(name, ctor);
    },
    get(name) {
      return definitions.get(name);
    },
  };
}

function scene(): SceneDocument {
  return {
    version: "1.0",
    scene: { width: 320, height: 180 },
    objects: [
      {
        id: "box",
        type: "rect",
        width: 80,
        height: 40,
        transform: { ...defaultTransform(), x: 80, y: 80 },
        style: defaultStyle(),
        visible: true,
        z: 0,
      },
    ],
    timeline: [
      {
        id: "move",
        type: "move",
        target: "box",
        start: 0,
        duration: 10_000,
        to: { x: 240, y: 80 },
      },
    ],
    markers: [
      { id: "one", label: "One", time: 2_500 },
      { id: "two", label: "Two", time: 7_500 },
    ],
  };
}

function installDomGlobals(reducedMotion = false): {
  media: {
    matches: boolean;
    listener: ((event: { matches: boolean }) => void) | undefined;
  };
} {
  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("HTMLButtonElement", FakeButtonElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
  vi.stubGlobal("HTMLOutputElement", FakeOutputElement);

  const media: {
    matches: boolean;
    listener: ((event: { matches: boolean }) => void) | undefined;
  } = { matches: reducedMotion, listener: undefined };

  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return media.matches;
    },
    addEventListener(_type: string, listener: (event: { matches: boolean }) => void) {
      media.listener = listener;
    },
    removeEventListener() {
      media.listener = undefined;
    },
  }));

  return { media };
}

function installControlNodes(root: FakeShadowRoot): void {
  root.elements.set("stage", new FakeHTMLElement());
  root.elements.set("play", new FakeButtonElement());
  root.elements.set("previous", new FakeButtonElement());
  root.elements.set("next", new FakeButtonElement());
  root.elements.set("restart", new FakeButtonElement());
  root.elements.set("timeline", new FakeInputElement());
  root.elements.set("time", new FakeOutputElement());
  root.elements.set("motion-note", new FakeHTMLElement());
  root.elements.set("summary", new FakeHTMLElement());
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("@anim8/web-component", () => {
  it("imports and explicit registration are SSR-safe with no browser globals", async () => {
    vi.unstubAllGlobals();
    vi.resetModules();

    const module = await import("../src/index.js");

    expect(typeof module.Anim8WebComponent).toBe("function");
    expect(() => module.defineAnim8WebComponent()).not.toThrow();
  });

  it("does not register on import and registers exactly once when explicitly requested", async () => {
    installDomGlobals();
    const customElements = registry();
    vi.stubGlobal("customElements", customElements);

    const module = await import("../src/index.js");
    expect(customElements.definitions.size).toBe(0);

    module.defineAnim8WebComponent();
    module.defineAnim8WebComponent();

    expect(customElements.definitions.size).toBe(1);
    expect(customElements.get("anim8-player")).toBe(module.Anim8WebComponent);
  });

  it("ships keyboard-operable, labelled native controls", async () => {
    installDomGlobals();
    const module = await import("../src/index.js");
    const element = new module.Anim8WebComponent();
    const html = (element.shadowRoot as unknown as FakeShadowRoot).innerHTML;

    expect(html).toContain('role="group" aria-label="Animation playback controls"');
    expect(html).toContain('aria-label="Play animation"');
    expect(html).toContain('aria-label="Previous step"');
    expect(html).toContain('aria-label="Restart animation"');
    expect(html).toContain('aria-label="Next step"');
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Animation timeline"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-describedby="summary"');
    expect(html).toContain('id="summary"');

    expect(module.playbackShortcutForKey(" ")).toBe("toggle");
    expect(module.playbackShortcutForKey("ArrowLeft")).toBe("seek-backward");
    expect(module.playbackShortcutForKey("ArrowRight")).toBe("seek-forward");
    expect(module.playbackShortcutForKey("Home")).toBe("restart");
    expect(module.playbackShortcutForKey("End")).toBe("end");
    expect(module.playbackShortcutForKey("Escape")).toBeNull();
  });

  it("honors reduced motion by disabling continuous playback while preserving scrubbing controls", async () => {
    installDomGlobals(true);
    const module = await import("../src/index.js");
    const element = new module.Anim8WebComponent();
    const root = element.shadowRoot as unknown as FakeShadowRoot;
    installControlNodes(root);

    element.scene = scene();
    element.connectedCallback();

    const play = root.getElementById("play") as FakeButtonElement;
    const timeline = root.getElementById("timeline") as FakeInputElement;
    const motionNote = root.getElementById("motion-note") as FakeHTMLElement;
    const summary = root.getElementById("summary") as FakeHTMLElement;

    expect(play.disabled).toBe(true);
    expect(timeline.disabled).toBe(false);
    expect(timeline.max).toBe("10000");
    expect(motionNote.hidden).toBe(false);
    expect(summary.textContent).toContain("Visible objects");
  });
});
