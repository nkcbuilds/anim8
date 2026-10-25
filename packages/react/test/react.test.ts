import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Anim8Player,
  useAnim8Player,
  type Anim8Scene,
} from "../src/index.js";

const scene: Anim8Scene = {
  version: "1.0",
  scene: {
    width: 320,
    height: 180,
    theme: "clean",
    background: "#f8fafc",
  },
  objects: [
    {
      id: "box",
      type: "rect",
      width: 100,
      height: 60,
      text: "<safe>",
      transform: {
        x: 20,
        y: 40,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
      },
      style: {
        fill: "#ffffff",
        stroke: "#111827",
        strokeWidth: 2,
        color: "#111827",
        fontSize: 16,
      },
      visible: true,
      z: 0,
    },
  ],
  timeline: [
    {
      id: "move_1",
      type: "move",
      target: "box",
      start: 0,
      duration: 1000,
      easing: "linear",
      to: { x: 120, y: 40 },
    },
  ],
};

describe("@anim8/react", () => {
  it("imports in a Node SSR environment without DOM globals", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    expect(typeof Anim8Player).toBe("function");
    expect(typeof useAnim8Player).toBe("function");
  });

  it("renders a real initial SVG during SSR", () => {
    const html = renderToStaticMarkup(
      createElement(Anim8Player, {
        scene,
        className: "demo",
        "aria-label": "Animation",
      }),
    );

    expect(html).toContain('class="demo"');
    expect(html).toContain('aria-label="Animation"');
    expect(html).toContain('data-anim8-player=""');
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('data-anim8-id="box"');
    expect(html).toContain("matrix(1 0 0 1 20 40)");
    expect(html).toContain("&lt;safe&gt;");
  });

  it("uses initialTime for the server-rendered SVG frame", () => {
    const html = renderToStaticMarkup(
      createElement(Anim8Player, {
        scene,
        initialTime: 1000,
      }),
    );

    expect(html).toContain("matrix(1 0 0 1 120 40)");
  });

  it("normalizes invalid initialTime to the initial frame", () => {
    const html = renderToStaticMarkup(
      createElement(Anim8Player, {
        scene,
        initialTime: Number.NaN,
      }),
    );

    expect(html).toContain("matrix(1 0 0 1 20 40)");
  });

  it("keeps the playback controller unset during server rendering", () => {
    function Probe() {
      const { containerRef, controllerRef } = useAnim8Player(scene, {
        autoplay: true,
        initialTime: 500,
      });

      return createElement("div", {
        ref: containerRef,
        "data-controller": controllerRef.current === null ? "none" : "mounted",
      });
    }

    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toBe('<div data-controller="none"></div>');
  });
  it("generates an SSR-safe accessible label and preserves an explicit host label", () => {
    const generated = renderToStaticMarkup(createElement(Anim8Player, { scene }));
    expect(generated).toContain('role="group"');
    expect(generated).toContain('aria-label="Visible objects: &lt;safe&gt;."');

    const explicit = renderToStaticMarkup(createElement(Anim8Player, {
      scene,
      "aria-label": "Custom animation description",
    }));
    expect(explicit).toContain('aria-label="Custom animation description"');
    expect(explicit).not.toContain('aria-label="Visible objects:');
  });

  it("can disable generated accessibility metadata", () => {
    const html = renderToStaticMarkup(createElement(Anim8Player, {
      scene,
      accessibility: false,
    }));
    expect(html).not.toContain('aria-label=');
    expect(html).not.toContain('role="group"');
  });

});
