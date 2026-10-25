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
