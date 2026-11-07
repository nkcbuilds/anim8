import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStyle, defaultTransform, type EvaluatedScene, type SceneDocument } from "@anim8/core";

const renderer = vi.hoisted(() => ({
  update: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@anim8/renderer-svg", () => ({
  mountSvg: vi.fn(() => ({
    update: renderer.update,
    destroy: renderer.destroy,
  })),
}));

import { mountPlayer } from "../src/index.js";

type Handler = (event: {
  target?: EventTarget | null;
  relatedTarget?: EventTarget | null;
  key?: string;
  preventDefault?: () => void;
}) => void;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly handlers = new Map<string, Handler>();
  readonly children: FakeElement[] = [];

  closest(selector: string): FakeElement | null {
    return selector === "[data-anim8-id]" && this.attributes.has("data-anim8-id") ? this : null;
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

  removeAttribute(name: string): void { this.attributes.delete(name); }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector !== "[data-anim8-id]") return [];
    return this.children.filter(child => child.hasAttribute("data-anim8-id"));
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    this.handlers.set(type, handler as unknown as Handler);
  }

  removeEventListener(type: string): void {
    this.handlers.delete(type);
  }

  fire(type: string, event: Parameters<Handler>[0]): void {
    this.handlers.get(type)?.(event);
  }
}

function scene(): SceneDocument {
  return {
    version: "1.0",
    scene: { width: 320, height: 180 },
    objects: [{
      id: "node",
      type: "rect",
      width: 80,
      height: 40,
      transform: defaultTransform(),
      style: defaultStyle(),
      visible: true,
      z: 0,
    }],
    timeline: [],
    state: { count: 0 },
    bindings: [{
      id: "count-x",
      target: { objectId: "node", property: "x" },
      expression: { kind: "get", path: "state.count" },
    }],
    interactions: [
      {
        id: "click",
        event: { type: "click", target: "node" },
        actions: [{ type: "increment", key: "count", by: 1 }],
      },
      {
        id: "focus",
        event: { type: "focus", target: "node" },
        actions: [{ type: "increment", key: "count", by: 10 }],
      },
      {
        id: "hover",
        event: { type: "hover", target: "node" },
        actions: [{ type: "increment", key: "count", by: 100 }],
      },
      {
        id: "advance",
        event: { type: "custom", name: "advance" },
        actions: [{ type: "increment", key: "count", by: 5 }],
      },
    ],
  };
}

describe("player declarative interactions", () => {
  it("replaces object callbacks without resetting time, rendering, or authored tab indices", () => {
    const container = new FakeElement(), target = new FakeElement();
    target.setAttribute("data-anim8-id", "node");
    container.children.push(target);
    const document = scene(); document.interactions = []; document.bindings = [];
    document.timeline = [{ id: "move", type: "move", target: "node", start: 0, duration: 1000, to: { x: 100, y: 0 } }];
    const controller = mountPlayer(container as unknown as Element, document);
    controller.seek(500);
    const first = vi.fn(), latest = vi.fn();
    const renders = renderer.update.mock.calls.length;
    controller.setObjectEventHandler(first);
    container.fire("click", { target: target as unknown as EventTarget });
    controller.setObjectEventHandler(latest);
    container.fire("click", { target: target as unknown as EventTarget });
    controller.setObjectEventHandler(undefined);
    container.fire("click", { target: target as unknown as EventTarget });
    expect(first).toHaveBeenCalledTimes(1); expect(latest).toHaveBeenCalledTimes(1);
    expect(controller.getTime()).toBe(500);
    expect(renderer.update.mock.calls).toHaveLength(renders);
    expect(target.hasAttribute("tabindex")).toBe(false);
    target.setAttribute("tabindex", "4");
    controller.setObjectEventHandler(first); controller.setObjectEventHandler(undefined);
    expect(target.getAttribute("tabindex")).toBe("4");
    controller.destroy();
  });
  it("ignores invalid seeks/speeds and cannot restart after destruction", () => {
    const frames: EvaluatedScene[] = [];
    const document = scene();
    document.timeline = [{ id: "move", type: "move", target: "node", start: 0, duration: 1000, to: { x: 100, y: 0 } }];
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
    const advance = (timestamp: number) => {
      const entry = callbacks.entries().next().value!;
      callbacks.delete(entry[0]); entry[1](timestamp);
    };
    const controller = mountPlayer(new FakeElement() as unknown as Element, document, { speed: NaN, onFrame: f => frames.push(f) });
    controller.seek(250);
    for (const time of [NaN, Infinity, -Infinity]) controller.seek(time);
    expect(controller.getTime()).toBe(250);
    controller.play(); advance(0); advance(100);
    expect(controller.getTime()).toBe(350);
    controller.destroy();
    const count = frames.length;
    controller.play(); controller.seek(500); controller.destroy();
    expect(controller.isPlaying()).toBe(false);
    expect(callbacks.size).toBe(0);
    expect(frames).toHaveLength(count);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a single animation callback when onFrame restarts playback at the end", () => {
    const document = scene();
    document.timeline = [{ id: "move", type: "move", target: "node", start: 0, duration: 1000, to: { x: 100, y: 0 } }];
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
    const controller = mountPlayer(new FakeElement() as unknown as Element, document, { onFrame: frame => {
      if (frame.time === 1000) { controller.seek(0); controller.play(); }
    } });
    controller.play();
    for (const timestamp of [0, 1000]) {
      const [key, callback] = callbacks.entries().next().value!;
      callbacks.delete(key); callback(timestamp);
    }
    expect(callbacks.size).toBe(1);
    controller.destroy();
  });

  it("stops a failed frame and can resume after the runtime input is corrected", () => {
    const document = scene();
    document.timeline = [{ id: "move", type: "move", target: "node", start: 0, duration: 1000, to: { x: 100, y: 0 } }];
    document.bindings = [{ id: "opacity", target: { objectId: "node", property: "opacity" }, expression: { kind: "op", op: "mul", args: [{ kind: "get", path: "time" }, { kind: "get", path: "inputs.factor" }] } }];
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
    const advance = (timestamp: number) => { const [key, callback] = callbacks.entries().next().value!; callbacks.delete(key); callback(timestamp); };
    const controller = mountPlayer(new FakeElement() as unknown as Element, document);
    controller.setInput("factor", 1e100);
    controller.play(); advance(0);
    expect(() => advance(100)).toThrow(/World opacity/);
    expect(controller.isPlaying()).toBe(false);
    expect(callbacks.size).toBe(0);
    controller.setInput("factor", 0.001);
    controller.play(); advance(200); advance(250);
    expect(controller.getTime()).toBe(150);
    expect(controller.isPlaying()).toBe(true);
    controller.destroy();
  });
  beforeEach(() => {
    renderer.update.mockClear();
    renderer.destroy.mockClear();
    vi.stubGlobal("Element", FakeElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires click/focus/hover events without requiring an imperative callback", () => {
    const container = new FakeElement();
    const target = new FakeElement();
    target.setAttribute("data-anim8-id", "node");
    container.children.push(target);

    const frames: EvaluatedScene[] = [];
    const controller = mountPlayer(container as unknown as Element, scene(), {
      onFrame: frame => frames.push(frame),
    });

    expect(target.getAttribute("tabindex")).toBe("0");

    container.fire("click", { target: target as unknown as EventTarget });
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(1);

    container.fire("focusin", { target: target as unknown as EventTarget });
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(11);

    container.fire("pointerover", {
      target: target as unknown as EventTarget,
      relatedTarget: null,
    });
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(111);

    controller.destroy();
  });

  it("dispatches custom named events into local state and re-evaluates", () => {
    const container = new FakeElement();
    const frames: EvaluatedScene[] = [];
    const controller = mountPlayer(container as unknown as Element, scene(), {
      onFrame: frame => frames.push(frame),
    });

    controller.dispatch("advance");
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(5);

    controller.dispatch("advance");
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(10);

    const frameCount = frames.length;
    controller.dispatch("unknown-event");
    expect(frames).toHaveLength(frameCount);

    controller.destroy();
  });

  it("dispatches state-machine events and exposes the explicit machine snapshot", () => {
    const container = new FakeElement();
    const doc = scene();
    doc.stateMachines = [{
      id: "flow",
      initial: "idle",
      states: [
        {
          id: "idle",
          transitions: [{
            id: "start",
            event: { type: "custom", name: "machine-advance" },
            target: "running",
            actions: [{ type: "increment", key: "count", by: 7 }],
          }],
        },
        { id: "running", transitions: [] },
      ],
    }];

    const frames: EvaluatedScene[] = [];
    const controller = mountPlayer(container as unknown as Element, doc, {
      onFrame: frame => frames.push(frame),
    });

    expect(controller.getMachineState("flow")).toBe("idle");
    controller.dispatch("machine-advance");
    expect(controller.getMachineState("flow")).toBe("running");
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(7);

    controller.dispatch("machine-advance");
    expect(controller.getMachineState("flow")).toBe("running");
    expect(frames.at(-1)?.objects[0]?.transform.x).toBe(7);

    controller.destroy();
  });
});
