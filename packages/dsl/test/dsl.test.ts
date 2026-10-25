import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const EXAMPLE = `# A small deterministic scene
scene 800 450 background "#f8fafc" seed 42
theme sketch
box left "2" at 100 150 size 120 60 fill "#ffffff"
box right "7" at 300 150
circle pivot "P" at 500 150 radius 35
connect left -> right kind curve label "compare"
step "Move left"
move left to 200 150 duration 500
step "Swap values"
swap left right duration 700
highlight right color "#fde68a" duration 250
`;

describe("@anim8/dsl", () => {
  it("compiles every DSL command into a SceneDocument", () => {
    const result = compile(EXAMPLE);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene).toEqual(expect.objectContaining({
      version: "1.0",
      scene: {
        width: 800,
        height: 450,
        theme: "sketch",
        background: "#f8fafc",
        seed: 42,
      },
    }));

    const scene = result.scene!;
    expect(scene.objects).toHaveLength(4);
    expect(scene.objects[0]).toEqual(expect.objectContaining({
      id: "left",
      type: "rect",
      width: 120,
      height: 60,
      text: "2",
      transform: expect.objectContaining({ x: 100, y: 150 }),
      style: expect.objectContaining({ fill: "#ffffff" }),
    }));
    expect(scene.objects[2]).toEqual(expect.objectContaining({
      id: "pivot",
      type: "circle",
      radius: 35,
      text: "P",
    }));
    expect(scene.objects[3]).toEqual(expect.objectContaining({
      id: "connector_1",
      type: "connector",
      from: { objectId: "left" },
      to: { objectId: "right" },
      kind: "curve",
      label: "compare",
    }));

    expect(scene.markers).toEqual([
      { id: "step_1", label: "Move left", time: 0 },
      { id: "step_2", label: "Swap values", time: 500 },
    ]);

    expect(scene.timeline).toHaveLength(4);
    expect(scene.timeline[0]).toEqual(expect.objectContaining({
      id: "move_1",
      type: "move",
      target: "left",
      start: 0,
      duration: 500,
      to: { x: 200, y: 150 },
    }));
    expect(scene.timeline[1]).toEqual(expect.objectContaining({
      id: "move_2",
      type: "move",
      target: "left",
      start: 500,
      duration: 700,
      path: "arc-up",
      to: { x: 300, y: 150 },
    }));
    expect(scene.timeline[2]).toEqual(expect.objectContaining({
      id: "move_3",
      type: "move",
      target: "right",
      start: 500,
      duration: 700,
      path: "arc-down",
      to: { x: 200, y: 150 },
    }));
    expect(scene.timeline[3]).toEqual(expect.objectContaining({
      id: "fill_4",
      type: "fill",
      target: "right",
      start: 1200,
      duration: 250,
      to: "#fde68a",
    }));
  });

  it("is deterministic for identical input", () => {
    expect(compile(EXAMPLE)).toEqual(compile(EXAMPLE));
  });

  it("reports line and column diagnostics for malformed input", () => {
    const result = compile(`scene 800 450
box node "Node" at nope 10
teleport node to 20 30
`);

    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_NUMBER", line: 2, column: 20 }),
      expect.objectContaining({ code: "UNKNOWN_COMMAND", line: 3, column: 1 }),
    ]));
  });

  it("rejects duplicate ids and references to objects not declared yet", () => {
    const result = compile(`scene 640 360
box a "A" at 0 0
box a "Again" at 10 10
move missing to 100 100
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "DUPLICATE_ID",
      "UNKNOWN_OBJECT",
    ]);
  });

  it("only accepts the fixed command language and never evaluates arbitrary code", () => {
    const result = compile(`scene 640 360
javascript "globalThis.compromised = true"
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "UNKNOWN_COMMAND", line: 2, column: 1 }),
    ]);
    expect((globalThis as { compromised?: boolean }).compromised).toBeUndefined();
  });

  it("reports lexical string errors without parsing the broken line", () => {
    const result = compile(`scene 640 360
box a "unterminated at 0 0
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "UNTERMINATED_STRING", line: 2, column: 7 }),
    ]);
  });

  it("requires an explicit scene command", () => {
    const result = compile('box a "A" at 0 0');

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "SCENE_REQUIRED", line: 1, column: 1 }),
    ]);
  });
});
