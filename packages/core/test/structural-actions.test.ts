import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  evaluate,
  validateScene,
  worldMatrix,
  type SceneDocument,
} from "../src/index.js";

const structuralScene = (): SceneDocument => ({
  version: "1.0",
  scene: { width: 400, height: 240 },
  objects: [
    {
      id: "container",
      type: "group",
      children: [],
      transform: { ...defaultTransform(), x: 100, y: 20 },
      style: defaultStyle(),
      visible: true,
      z: 0,
    },
    {
      id: "card",
      type: "rect",
      width: 60,
      height: 40,
      transform: { ...defaultTransform(), x: 20, y: 30 },
      style: defaultStyle(),
      visible: true,
      z: 1,
    },
  ],
  timeline: [
    {
      id: "group-card",
      type: "reparent",
      target: "card",
      parentId: "container",
      preserveWorld: true,
      start: 500,
      duration: 0,
      easing: "linear",
    },
    {
      id: "bring-front",
      type: "zOrder",
      target: "card",
      to: 9,
      start: 700,
      duration: 0,
      easing: "linear",
    },
    {
      id: "ungroup-card",
      type: "reparent",
      target: "card",
      parentId: null,
      preserveWorld: true,
      start: 900,
      duration: 0,
      easing: "linear",
    },
  ],
});

describe("structural timeline actions", () => {
  it("reparents without a world-space jump and remains random-access deterministic", () => {
    const doc = structuralScene();
    expect(validateScene(doc)).toEqual([]);

    const before = evaluate(doc, 499);
    const grouped = evaluate(doc, 500);
    const groupedAgain = evaluate(doc, 500);

    const beforeCard = before.objects.find(object => object.id === "card")!;
    const groupedCard = grouped.objects.find(object => object.id === "card")!;
    const groupedIndex = new Map(grouped.objects.map(object => [object.id, object]));

    expect(groupedAgain).toEqual(grouped);
    expect(beforeCard.parentId).toBeUndefined();
    expect(groupedCard.parentId).toBe("container");
    expect(worldMatrix(groupedCard, groupedIndex).e).toBeCloseTo(20, 8);
    expect(worldMatrix(groupedCard, groupedIndex).f).toBeCloseTo(30, 8);
    expect(grouped.objects.find(object => object.id === "container")?.type === "group" &&
      grouped.objects.find(object => object.id === "container")?.children).toContain("card");
  });

  it("applies z-order and ungroup actions at exact timestamps", () => {
    const doc = structuralScene();
    expect(evaluate(doc, 699).objects.find(object => object.id === "card")?.z).toBe(1);
    expect(evaluate(doc, 700).objects.find(object => object.id === "card")?.z).toBe(9);

    const ungrouped = evaluate(doc, 900);
    const card = ungrouped.objects.find(object => object.id === "card")!;
    const index = new Map(ungrouped.objects.map(object => [object.id, object]));
    expect(card.parentId).toBeUndefined();
    expect(worldMatrix(card, index).e).toBeCloseTo(20, 8);
    expect(worldMatrix(card, index).f).toBeCloseTo(30, 8);

    const rewound = evaluate(doc, 100);
    expect(rewound.objects.find(object => object.id === "card")?.parentId).toBeUndefined();
    expect(rewound.objects.find(object => object.id === "card")?.transform.x).toBe(20);
  });
});
