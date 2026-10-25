import { describe, expect, it } from "vitest";
import { scene } from "@anim8/authoring";
import type { DrawableObject } from "@anim8/core";
import {
  array,
  callout,
  codeBlock,
  database,
  document,
  graphNode,
  pointer,
  queue,
  server,
  stack,
  table,
  treeNode,
} from "../src/index.js";

function objectById(objects: readonly DrawableObject[], id: string): DrawableObject {
  const object = objects.find(item => item.id === id);
  if (!object) throw new Error(`Missing object '${id}'.`);
  return object;
}

describe("@anim8/presets", () => {
  it("composes infrastructure/document presets from normal authoring shapes and keeps them actionable/connectable", () => {
    const builder = scene({ width: 900, height: 500 });
    const db = database(builder, "users", { id: "db", x: 130, y: 180 });
    const api = server(builder, "api", { id: "api", x: 390, y: 180 });
    const spec = document(builder, "schema", { id: "doc", x: 650, y: 180 });

    const dbToApi = builder.connect(db.anchor, api.anchor, { from: "right", to: "left", label: "SQL" });
    builder.connect(api.anchor, spec.anchor, { from: "right", to: "left", kind: "curve" });
    builder.parallel(
      db.group.moveTo({ x: 150, y: 210 }, { duration: 500, easing: "linear" }),
      spec.group.fadeTo(0.5, { duration: 500, easing: "linear" }),
    );

    const doc = builder.toJSON();

    expect(objectById(doc.objects, db.group.id)).toEqual(expect.objectContaining({
      type: "group",
      id: "db",
    }));
    expect(objectById(doc.objects, db.anchor.id)).toEqual(expect.objectContaining({
      type: "rect",
      parentId: "db",
    }));
    expect(objectById(doc.objects, api.anchor.id)).toEqual(expect.objectContaining({
      type: "rect",
      parentId: "api",
    }));
    expect(objectById(doc.objects, spec.anchor.id)).toEqual(expect.objectContaining({
      type: "polygon",
      parentId: "doc",
    }));

    const edge = objectById(doc.objects, dbToApi.id);
    expect(edge).toEqual(expect.objectContaining({
      type: "connector",
      from: { objectId: db.anchor.id, anchor: "right" },
      to: { objectId: api.anchor.id, anchor: "left" },
    }));

    expect(doc.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "move", target: db.group.id, to: { x: 150, y: 210 } }),
      expect.objectContaining({ type: "opacity", target: spec.group.id, to: 0.5 }),
    ]));
  });

  it("builds table/array/stack/queue from generic frame, divider, and text primitives", () => {
    const builder = scene();
    const matrix = table(builder, [["A", "B"], ["1", "2"]], {
      id: "table",
      x: 160,
      y: 100,
      cellWidth: 50,
      cellHeight: 30,
    });
    const values = array(builder, ["0", "1", "2"], { id: "array", x: 400, y: 80 });
    const lifo = stack(builder, ["top", "mid", "bottom"], { id: "stack", x: 580, y: 140 });
    const fifo = queue(builder, ["in", "mid", "out"], { id: "queue", x: 400, y: 240 });

    const doc = builder.toJSON();

    const tableFrame = objectById(doc.objects, matrix.parts.frame.id);
    expect(tableFrame).toEqual(expect.objectContaining({ type: "rect", width: 100, height: 60 }));
    expect(matrix.parts.dividers).toHaveLength(2);
    expect(matrix.parts.cells).toHaveLength(4);

    expect(objectById(doc.objects, values.parts.frame.id)).toEqual(expect.objectContaining({
      type: "rect",
      width: 192,
      height: 38,
    }));
    expect(values.parts.dividers).toHaveLength(2);

    expect(objectById(doc.objects, lifo.parts.frame.id)).toEqual(expect.objectContaining({
      type: "rect",
      width: 64,
      height: 114,
    }));
    expect(lifo.parts.dividers).toHaveLength(2);

    expect(objectById(doc.objects, fifo.parts.frame.id)).toEqual(expect.objectContaining({
      type: "rect",
      width: 192,
      height: 38,
    }));

    for (const preset of [matrix, values, lifo, fifo]) {
      expect(objectById(doc.objects, preset.group.id).type).toBe("group");
      expect(objectById(doc.objects, preset.anchor.id).parentId).toBe(preset.group.id);
    }
  });

  it("provides pointer and node presets that participate in normal draw actions and connectors", () => {
    const builder = scene({ width: 700, height: 360 });
    const arrow = pointer(
      builder,
      { x: 80, y: 120 },
      { x: 240, y: 120 },
      { id: "ptr", drawProgress: 0 },
    );
    const tree = treeNode(builder, "root", { id: "tree", x: 340, y: 120 });
    const graph = graphNode(builder, "B", { id: "graph", x: 500, y: 120 });

    builder.sequence(arrow.parts.shaft.draw(1, { duration: 400, easing: "linear" }));
    const edge = builder.connect(tree.anchor, graph.anchor, { from: "right", to: "left" });

    const doc = builder.toJSON();
    expect(objectById(doc.objects, arrow.parts.shaft.id)).toEqual(expect.objectContaining({
      type: "polyline",
      drawProgress: 0,
      parentId: "ptr",
    }));
    expect(objectById(doc.objects, arrow.parts.head.id)).toEqual(expect.objectContaining({
      type: "polygon",
      parentId: "ptr",
    }));
    expect(doc.timeline[0]).toEqual(expect.objectContaining({
      type: "draw",
      target: arrow.parts.shaft.id,
      to: 1,
    }));
    expect(objectById(doc.objects, edge.id)).toEqual(expect.objectContaining({
      type: "connector",
      from: { objectId: tree.anchor.id, anchor: "right" },
      to: { objectId: graph.anchor.id, anchor: "left" },
    }));
  });

  it("builds callout and codeBlock as grouped generic shapes with addressable parts", () => {
    const builder = scene();
    const note = callout(builder, "watch this", { id: "note", x: 180, y: 120 });
    const code = codeBlock(builder, ["const x = 1;", "return x + 1;"], {
      id: "code",
      x: 480,
      y: 150,
    });

    builder.parallel(
      note.group.scale(1.2, { duration: 300 }),
      code.group.moveTo({ x: 500, y: 170 }, { duration: 300 }),
    );

    const doc = builder.toJSON();

    expect(objectById(doc.objects, note.parts.body.id).type).toBe("rect");
    expect(objectById(doc.objects, note.parts.tail.id).type).toBe("polygon");
    expect(objectById(doc.objects, note.parts.text.id).type).toBe("text");

    expect(objectById(doc.objects, code.parts.body.id)).toEqual(expect.objectContaining({
      type: "rect",
      parentId: "code",
    }));
    expect(code.parts.lines).toHaveLength(2);
    for (const line of code.parts.lines) {
      expect(objectById(doc.objects, line.id)).toEqual(expect.objectContaining({
        type: "text",
        parentId: "code",
      }));
    }

    expect(doc.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "scale", target: note.group.id }),
      expect.objectContaining({ type: "move", target: code.group.id }),
    ]));
  });

  it("uses only core generic drawable types and rejects degenerate pointers", () => {
    const builder = scene();
    database(builder);
    server(builder);
    document(builder);
    table(builder, [["x"]]);
    array(builder, ["x"]);
    stack(builder, ["x"]);
    queue(builder, ["x"]);
    treeNode(builder, "x");
    graphNode(builder, "x");
    callout(builder, "x");
    codeBlock(builder, "x");

    const allowed = new Set([
      "rect",
      "circle",
      "ellipse",
      "polygon",
      "polyline",
      "text",
      "group",
    ]);
    for (const object of builder.toJSON().objects) {
      expect(allowed.has(object.type)).toBe(true);
    }

    expect(() => pointer(builder, { x: 10, y: 10 }, { x: 10, y: 10 })).toThrow(
      "Pointer endpoints must be finite and distinct",
    );
  });
});
