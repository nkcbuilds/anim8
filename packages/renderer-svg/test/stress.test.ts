import { describe, expect, it } from "vitest";
import { evaluate, sceneDuration, type SceneDocument } from "@anim8/core";
import { mountSvg } from "../src/index.js";
import { generateValidScene } from "../../../tests/stress/generators.js";

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

describe("mountSvg create/update/destroy stress", () => {
  it("survives repeated deterministic mount/update/destroy cycles without a browser DOM", () => {
    for (let seed = 200; seed < 224; seed += 1) {
      const scene = generateValidScene(seed) as unknown as SceneDocument;
      const duration = sceneDuration(scene);
      const document = new FakeDocument();
      const container = new FakeElement("div", document);
      const mount = mountSvg(
        container as unknown as Element,
        evaluate(scene, 0),
      );

      const svg = container.childNodes[0];
      expect(svg, `seed ${seed}`).toBeDefined();

      for (const progress of [0.1, 0.33, 0.67, 1]) {
        mount.update(evaluate(scene, duration * progress));
        expect(container.childNodes[0], `root replaced for seed ${seed}`).toBe(svg);
      }

      mount.destroy();
      expect(container.childNodes, `destroy leaked root for seed ${seed}`).toHaveLength(0);

      // Destruction should be idempotent for normal cleanup paths.
      mount.destroy();
      expect(container.childNodes).toHaveLength(0);
    }
  });
});
