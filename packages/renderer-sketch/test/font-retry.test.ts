import { beforeEach, expect, it, vi } from "vitest";
import { defaultStyle, defaultTransform, evaluate, type SceneDocument } from "@anim8/core";

const fontRule = vi.hoisted(() => vi.fn());
vi.mock("../src/font.js", () => ({ sketchFontFaceCss: fontRule }));

class Node {
  children: Node[] = [];
  attributes = new Map<string, string>();
  parentNode: Node | null = null;
  innerHTML = "";
  textContent = "";
  namespaceURI = "http://www.w3.org/2000/svg";
  constructor(readonly tagName: string) {}
  get firstElementChild(): Node | null { return this.children[0] ?? null; }
  get childNodes() { return this.children; }
  get isConnected() { return this.parentNode !== null; }
  get nextElementSibling(): Node | null {
    const siblings = this.parentNode?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  appendChild(child: Node) { return this.insertBefore(child, null); }
  insertBefore(child: Node, next: Node | null): Node {
    child.remove(); child.parentNode = this;
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child); return child;
  }
  replaceChildren(...nodes: Node[]) { for (const child of [...this.children]) child.remove(); for (const child of nodes) this.appendChild(child); }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  querySelector(selector: string): Node | null {
    if (selector === "style[data-anim8-sketch-font]") return this.children.find(child => child.tagName === "style" && child.attributes.has("data-anim8-sketch-font")) ?? null;
    return null;
  }
}

const scene: SceneDocument = { version: "1.0", scene: { width: 100, height: 100 }, timeline: [], objects: [
  { id: "label", type: "text", text: "Hello", style: defaultStyle(), transform: defaultTransform(), visible: true, z: 0 },
] };

beforeEach(() => { vi.resetModules(); fontRule.mockReset(); });

it.each(["document", "svg"] as const)("retries a failed bundled font in %s mode across existing and new mounts", async font => {
  fontRule.mockImplementationOnce(() => { throw new Error("chunk unavailable"); }).mockReturnValue("@font-face{font-family:Virgil}");
  const { mountSketchSvg } = await import("../src/mount.js");
  const head = new Node("head");
  const document = { head, createElement: (tag: string) => new Node(tag), createElementNS: (_ns: string, tag: string) => new Node(tag) };
  const host = () => Object.assign(new Node("div"), { ownerDocument: document }) as unknown as Element;
  const first = host(), second = host(), frame = evaluate(scene, 0);
  const one = mountSketchSvg(first, frame, { font });
  const two = mountSketchSvg(second, frame, { font });
  await vi.waitFor(() => expect(fontRule).toHaveBeenCalledTimes(1));
  await new Promise(resolve => setTimeout(resolve, 0));
  one.update(frame); two.update(frame);
  await vi.waitFor(() => expect(fontRule).toHaveBeenCalledTimes(2));
  await new Promise(resolve => setTimeout(resolve, 0));
  const three = mountSketchSvg(host(), frame, { font });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fontRule).toHaveBeenCalledTimes(2);
  if (font === "document") expect(head.children).toHaveLength(1);
  const styles = font === "document" ? head.children : (first as unknown as Node).children[0]!.children.flatMap(n => n.children).filter(n => n.tagName === "style");
  expect(styles[0]?.textContent).toContain("@font-face");
  one.destroy(); two.destroy(); three.destroy();
});
