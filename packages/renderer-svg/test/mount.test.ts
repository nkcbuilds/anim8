import { describe, expect, it } from "vitest";
import {
  defaultCamera,
  defaultStyle,
  defaultTransform,
  type CameraState,
  type DrawableObject,
  type EvaluatedScene,
} from "@anim8/core";
import { mountSvg } from "../src/index.js";

class FakeDocument {
  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  textContent: string | null = null;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  get nextSibling(): FakeElement | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return index >= 0 ? this.parentNode.childNodes[index + 1] ?? null : null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.remove();
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore<T extends FakeElement>(child: T, reference: FakeElement | null): T {
    child.remove();
    if (reference === null) return this.appendChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error("reference child is not attached");
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild<T extends FakeElement>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error("child is not attached");
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    for (const child of children) this.appendChild(child);
  }
}

function frame(objects: DrawableObject[], background?: string, camera: CameraState = defaultCamera()): EvaluatedScene {
  return {
    version: "1.0",
    scene: {
      width: 500,
      height: 240,
      ...(background ? { background } : {}),
    },
    camera,
    objects,
    time: 0,
    duration: 0,
  };
}

function rect(
  id: string,
  x: number,
  text: string,
  fill = "#ffffff",
  visible = true,
): DrawableObject {
  return {
    id,
    type: "rect",
    width: 80,
    height: 40,
    text,
    transform: { ...defaultTransform(), x, y: 100 },
    style: { ...defaultStyle(), fill },
    visible,
    z: 1,
  };
}

function label(id: string, x: number, text: string): DrawableObject {
  return {
    id,
    type: "text",
    text,
    transform: { ...defaultTransform(), x, y: 40 },
    style: defaultStyle(),
    visible: true,
    z: 2,
  };
}

function findByAnim8Id(root: FakeElement, id: string): FakeElement | undefined {
  if (root.getAttribute("data-anim8-id") === id) return root;
  for (const child of root.childNodes) {
    const found = findByAnim8Id(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("mountSvg incremental DOM updates", () => {
  it("preserves root and keyed object identity while updating geometry, style, and text", () => {
    const document = new FakeDocument();
    const container = new FakeElement("div", document);

    const mount = mountSvg(
      container as unknown as Element,
      frame([rect("box", 80, "before"), label("caption", 80, "old")], "#f8fafc"),
    );

    const svg = container.childNodes[0]!;
    const box = findByAnim8Id(svg, "box")!;
    const caption = findByAnim8Id(svg, "caption")!;

    const updatedBox = rect("box", 180, "after", "#fee2e2") as Extract<DrawableObject, { type: "rect" }>;
    updatedBox.width = 120;
    mount.update(frame([updatedBox, label("caption", 180, "new")], "#ffffff"));

    const nextSvg = container.childNodes[0]!;
    const nextBox = findByAnim8Id(nextSvg, "box")!;
    const nextCaption = findByAnim8Id(nextSvg, "caption")!;

    expect(nextSvg).toBe(svg);
    expect(nextBox).toBe(box);
    expect(nextCaption).toBe(caption);
    expect(nextBox.getAttribute("transform")).toBe("matrix(1 0 0 1 180 100)");
    expect(nextBox.getAttribute("fill")).toBe("#fee2e2");
    expect(nextBox.childNodes[0]!.getAttribute("width")).toBe("120");
    expect(nextBox.childNodes[1]!.textContent).toBe("after");
    expect(nextCaption.textContent).toBe("new");
  });

  it("updates only the top-level camera transform while preserving keyed objects", () => {
    const document = new FakeDocument();
    const container = new FakeElement("div", document);
    const mount = mountSvg(
      container as unknown as Element,
      frame([rect("box", 80, "A")]),
    );

    const svg = container.childNodes[0]!;
    const world = svg.childNodes.find(child => child.getAttribute("data-anim8-camera") === "world")!;
    const box = findByAnim8Id(svg, "box")!;
    expect(world.getAttribute("transform")).toBe("matrix(1 0 0 1 0 0)");

    mount.update(frame([rect("box", 80, "A")], undefined, { x: 30, y: -10, zoom: 2 }));

    expect(world.getAttribute("transform")).toBe("matrix(2 0 0 2 30 -10)");
    expect(findByAnim8Id(svg, "box")).toBe(box);
    expect(box.getAttribute("transform")).toBe("matrix(1 0 0 1 80 100)");
  });

  it("canonicalizes mounted numeric attributes and path data", () => {
    const document = new FakeDocument();
    const container = new FakeElement("div", document);
    const line: DrawableObject = {
      id: "line",
      type: "line",
      x2: -0,
      y2: 1.23456789,
      transform: { ...defaultTransform(), x: 10.123456789, y: -0.0000004 },
      style: { ...defaultStyle(), strokeWidth: 1.23456789 },
      visible: true,
      z: 0,
    };
    const path: DrawableObject = {
      id: "path",
      type: "path",
      d: "M -0 -0.0000004 L 1.23456789 2.34567891",
      transform: defaultTransform(),
      style: { ...defaultStyle(), fill: "none" },
      visible: true,
      z: 1,
    };

    mountSvg(
      container as unknown as Element,
      frame(
        [line, path],
        undefined,
        { x: -0.0000004, y: 2.34567891, zoom: 1.23456789 },
      ),
    );

    const svg = container.childNodes[0]!;
    const world = svg.childNodes.find(child => child.getAttribute("data-anim8-camera") === "world")!;
    const mountedLine = findByAnim8Id(svg, "line")!;
    const mountedPath = findByAnim8Id(svg, "path")!;

    expect(world.getAttribute("transform")).toBe("matrix(1.234568 0 0 1.234568 0 2.345679)");
    expect(mountedLine.getAttribute("transform")).toBe("matrix(1 0 0 1 10.123457 0)");
    expect(mountedLine.getAttribute("stroke-width")).toBe("1.234568");
    expect(mountedLine.getAttribute("x2")).toBe("0");
    expect(mountedLine.getAttribute("y2")).toBe("1.234568");
    expect(mountedPath.getAttribute("d")).toBe("M 0 0 L 1.234568 2.345679");
  });

  it("updates an existing connector path when endpoint geometry moves", () => {
    const document = new FakeDocument();
    const container = new FakeElement("div", document);
    const edge: DrawableObject = {
      id: "edge",
      type: "connector",
      from: { objectId: "a", anchor: "right" },
      to: { objectId: "b", anchor: "left" },
      kind: "straight",
      transform: defaultTransform(),
      style: defaultStyle(),
      visible: true,
      z: 0,
    };

    const mount = mountSvg(
      container as unknown as Element,
      frame([rect("a", 80, "A"), rect("b", 300, "B"), edge]),
    );

    const svg = container.childNodes[0]!;
    const connector = findByAnim8Id(svg, "edge")!;
    expect(connector.getAttribute("d")).toBe("M 120 100 L 260 100");

    mount.update(frame([rect("a", 180, "A"), rect("b", 300, "B"), edge]));

    const nextConnector = findByAnim8Id(svg, "edge")!;
    expect(nextConnector).toBe(connector);
    expect(nextConnector.getAttribute("d")).toBe("M 220 100 L 260 100");
  });

  it("detaches hidden objects without losing identity and handles additions/removals", () => {
    const document = new FakeDocument();
    const container = new FakeElement("div", document);
    const mount = mountSvg(
      container as unknown as Element,
      frame([rect("a", 80, "A"), rect("b", 220, "B")]),
    );

    const svg = container.childNodes[0]!;
    const a = findByAnim8Id(svg, "a")!;

    mount.update(frame([
      rect("a", 80, "A", "#ffffff", false),
      rect("b", 220, "B"),
      rect("c", 360, "C"),
    ]));

    expect(findByAnim8Id(svg, "a")).toBeUndefined();
    expect(findByAnim8Id(svg, "c")).toBeDefined();

    mount.update(frame([
      rect("a", 100, "A", "#ffffff", true),
      rect("c", 360, "C"),
    ]));

    expect(findByAnim8Id(svg, "a")).toBe(a);
    expect(findByAnim8Id(svg, "b")).toBeUndefined();

    mount.destroy();
    expect(container.childNodes).toHaveLength(0);
  });
});
