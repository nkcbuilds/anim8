import { describe, expect, it } from "vitest";
import {
  objectSketchSeed,
  sketchEllipse,
  sketchJitter,
  sketchLine,
  sketchPathToSvg,
  sketchRectangle,
  type SketchPath,
} from "../src/index.js";

function translatePath(path: SketchPath, dx: number, dy: number): SketchPath {
  return {
    commands: path.commands.map(command => {
      if (command.type === "M" || command.type === "L") {
        return { ...command, to: { x: command.to.x + dx, y: command.to.y + dy } };
      }
      return {
        ...command,
        cp1: { x: command.cp1.x + dx, y: command.cp1.y + dy },
        cp2: { x: command.cp2.x + dx, y: command.cp2.y + dy },
        to: { x: command.to.x + dx, y: command.to.y + dy },
      };
    }),
  };
}

describe("@anim8/sketch", () => {
  it("derives a stable per-object seed from id + scene seed", () => {
    expect(objectSketchSeed(42, "node-a")).toBe(objectSketchSeed(42, "node-a"));
    expect(objectSketchSeed(43, "node-a")).not.toBe(objectSketchSeed(42, "node-a"));
    expect(objectSketchSeed(42, "node-b")).not.toBe(objectSketchSeed(42, "node-a"));
  });

  it("keeps same id + seed stroke geometry bit-for-bit stable", () => {
    const context = { seed: 1234, objectId: "box-7", roughness: 1.4, bowing: 0.8 };
    const first = sketchLine({ x: -40, y: 0 }, { x: 40, y: 0 }, context);
    const second = sketchLine({ x: -40, y: 0 }, { x: 40, y: 0 }, context);

    expect(second).toEqual(first);
    expect(first.map(sketchPathToSvg)).toEqual(second.map(sketchPathToSvg));
  });

  it("changes stroke geometry when the seed changes", () => {
    const geometry = { from: { x: -40, y: 0 }, to: { x: 40, y: 0 } };
    const first = sketchLine(geometry.from, geometry.to, { seed: 1, objectId: "box-7" });
    const second = sketchLine(geometry.from, geometry.to, { seed: 2, objectId: "box-7" });

    expect(second).not.toEqual(first);
  });

  it("uses keyed jitter so call order does not affect a mark", () => {
    const expected = sketchJitter(99, "node", "outline:left", 2);
    sketchJitter(99, "node", "unrelated:new-site", 2);
    expect(sketchJitter(99, "node", "outline:left", 2)).toBe(expected);
  });

  it("is translation-equivariant, preventing boiling when objects move", () => {
    const context = { seed: "scene-a", objectId: "moving-node", roughness: 1.25 };
    const base = sketchLine({ x: -50, y: 0 }, { x: 50, y: 0 }, context);
    const moved = sketchLine({ x: 150, y: 70 }, { x: 250, y: 70 }, context);

    expect(moved).toEqual(base.map(path => translatePath(path, 200, 70)));
  });

  it("generates deterministic rectangle and ellipse helpers", () => {
    const context = { seed: 7, objectId: "shape" };

    expect(sketchRectangle(-20, -10, 40, 20, context)).toEqual(
      sketchRectangle(-20, -10, 40, 20, context),
    );
    expect(sketchEllipse(0, 0, 30, 20, context)).toEqual(
      sketchEllipse(0, 0, 30, 20, context),
    );
  });
});
