import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  routeConnector,
  type ConnectorObject,
  type DrawableObject,
} from "../src/index.js";

const box = (id: string, x: number, y: number, width: number, height: number): DrawableObject => ({
  id,
  type: "rect",
  width,
  height,
  transform: { ...defaultTransform(), x, y },
  style: defaultStyle(),
  visible: true,
  z: 0,
});

const connector = (): ConnectorObject => ({
  id: "edge",
  type: "connector",
  from: { objectId: "from", anchor: "right" },
  to: { objectId: "to", anchor: "left" },
  kind: "routed",
  routing: { clearance: 10, bendPenalty: 8 },
  transform: defaultTransform(),
  style: defaultStyle(),
  visible: true,
  z: 10,
});

describe("obstacle-aware connector routing", () => {
  it("routes deterministically around world-space obstacles", () => {
    const objects = [
      box("from", 20, 90, 40, 40),
      box("block", 160, 90, 80, 80),
      box("to", 300, 90, 40, 40),
      connector(),
    ];
    const index = new Map(objects.map(object => [object.id, object]));

    const first = routeConnector(connector(), index);
    const second = routeConnector(connector(), index);

    expect(first).toEqual(second);
    expect(first[0]).toEqual({ x: 40, y: 90 });
    expect(first.at(-1)).toEqual({ x: 280, y: 90 });
    expect(first.length).toBeGreaterThan(2);
    expect(first.some(point => point.y !== 90)).toBe(true);
  });

  it("recomputes from evaluated object geometry without retained routing state", () => {
    const edge = connector();
    const objects = [
      box("from", 20, 90, 40, 40),
      box("block", 160, 90, 80, 80),
      box("to", 300, 90, 40, 40),
      edge,
    ];
    const index = new Map(objects.map(object => [object.id, object]));
    const before = routeConnector(edge, index);
    (index.get("block")!.transform.y) = 220;
    const after = routeConnector(edge, index);

    expect(before).not.toEqual(after);
    expect(after).toEqual([
      { x: 40, y: 90 },
      { x: 280, y: 90 },
    ]);
  });
});
