import type { EvaluatedScene } from "@anim8/core";
import { composeSketchSvg, renderSketchFrame, type SketchFrameMarkup } from "./render.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT_STYLE_ATTRIBUTE = "data-anim8-sketch-font";

export interface SketchMount {
  update(frame: EvaluatedScene): void;
  destroy(): void;
}

export interface SketchMountOptions {
  /**
   * Where the bundled font's `@font-face` goes. `"document"` (default) adds it
   * once to the document head, shared by every mounted scene; `"svg"` puts it
   * inside this SVG.
   */
  font?: "document" | "svg";
}

interface GroupRecord {
  element: SVGGElement;
  attributes: Readonly<Record<string, string>>;
  body: string;
}

let fontCss: Promise<string> | undefined;

/** Load the font face lazily; bundlers emit the ~75 KB font as its own chunk. */
function loadFontCss(): Promise<string> {
  fontCss ??= import("./font.js").then(module => module.sketchFontFaceCss());
  return fontCss;
}

function ensureDocumentFont(document: Document): boolean {
  const head = document.head;
  if (!head || typeof head.querySelector !== "function") return false;
  if (head.querySelector(`style[${FONT_STYLE_ATTRIBUTE}]`)) return true;
  const style = document.createElement("style");
  style.setAttribute(FONT_STYLE_ATTRIBUTE, "");
  head.appendChild(style);
  void loadFontCss().then(css => { style.textContent = css; }, () => { style.remove(); });
  return true;
}

/**
 * Mount a live hand-drawn SVG that updates frame by frame.
 *
 * Each object keeps one stable `<g data-anim8-id>` element: transform and
 * opacity are updated in place, and its marks are re-parsed only when they
 * change. Moving objects therefore cost one attribute write per frame, and
 * focus, tabindex and listeners on object elements survive playback. An
 * existing server-rendered sketch SVG in the container is adopted, not replaced.
 *
 * The bundled font is loaded on first mount and injected once; until it
 * arrives (a moment, from a local chunk) text uses the fallback font.
 */
export function mountSketchSvg(container: Element, frame: EvaluatedScene, options: SketchMountOptions = {}): SketchMount {
  const document = container.ownerDocument ?? (globalThis as { document?: Document }).document;

  // Hosts without a real SVG DOM fall back to string rendering.
  if (!document?.createElementNS || typeof container.replaceChildren !== "function") {
    const host = container as Element & { innerHTML: string };
    const update = (next: EvaluatedScene) => { host.innerHTML = composeSketchSvg(renderSketchFrame(next)); };
    update(frame);
    return { update, destroy: () => { host.innerHTML = ""; } };
  }

  const fontInDocument = (options.font ?? "document") === "document" && ensureDocumentFont(document);
  const records = new Map<string, GroupRecord>();
  const scratch = document.createElementNS(SVG_NS, "g") as SVGGElement;

  let svg: SVGSVGElement;
  let world: SVGGElement;
  let background: SVGRectElement | undefined;
  let fontStyle: SVGStyleElement | undefined;

  const existing = container.firstElementChild;
  const existingWorld = existing?.namespaceURI === SVG_NS && existing.tagName.toLowerCase() === "svg"
    ? Array.from(existing.children).find(child => child.getAttribute("data-anim8-camera") === "world")
    : undefined;

  if (existing && existingWorld && container.children.length === 1) {
    // Adopt server-rendered markup produced by renderSketchSvg for this frame.
    svg = existing as SVGSVGElement;
    world = existingWorld as SVGGElement;
    background = Array.from(svg.children).find(child => child.getAttribute("data-sketch-part") === "background") as SVGRectElement | undefined;
    const initial = renderSketchFrame(frame);
    const byId = new Map(initial.objects.map(object => [object.id, object]));
    for (const child of Array.from(world.children)) {
      const id = child.getAttribute("data-anim8-id");
      const markup = id ? byId.get(id) : undefined;
      if (!id || !markup || child.tagName.toLowerCase() !== "g") {
        child.remove();
        continue;
      }
      records.set(id, { element: child as SVGGElement, attributes: markup.attributes, body: markup.body });
    }
  } else {
    svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("role", "img");
    world = document.createElementNS(SVG_NS, "g") as SVGGElement;
    world.setAttribute("data-anim8-camera", "world");
    svg.appendChild(world);
    container.replaceChildren(svg);
  }

  const syncFont = (parts: SketchFrameMarkup) => {
    if (fontInDocument || !parts.usesBundledFont || fontStyle) return;
    const defs = document.createElementNS(SVG_NS, "defs");
    const style = document.createElementNS(SVG_NS, "style") as SVGStyleElement;
    fontStyle = style;
    defs.appendChild(style);
    void loadFontCss().then(css => { style.textContent = css; }, () => undefined);
    svg.insertBefore(defs, svg.firstChild);
  };

  const syncBackground = (parts: SketchFrameMarkup) => {
    if (parts.background) {
      if (!background) {
        background = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
        background.setAttribute("data-sketch-part", "background");
        background.setAttribute("width", "100%");
        background.setAttribute("height", "100%");
        svg.insertBefore(background, world);
      }
      background.setAttribute("fill", parts.background);
    } else if (background) {
      background.remove();
      background = undefined;
    }
  };

  const update = (next: EvaluatedScene) => {
    const parts = renderSketchFrame(next);
    svg.setAttribute("viewBox", `0 0 ${parts.width} ${parts.height}`);
    world.setAttribute("transform", parts.camera);
    syncFont(parts);
    syncBackground(parts);

    const live = new Set(parts.objects.map(object => object.id));
    for (const [id, record] of records) {
      if (!live.has(id)) {
        record.element.remove();
        records.delete(id);
      }
    }

    let previous: Element | null = null;
    for (const object of parts.objects) {
      let record = records.get(object.id);
      if (!record) {
        const element = document.createElementNS(SVG_NS, "g") as SVGGElement;
        element.setAttribute("data-anim8-id", object.id);
        record = { element, attributes: {}, body: "" };
        records.set(object.id, record);
      }
      for (const [name, value] of Object.entries(object.attributes)) {
        if (record.attributes[name] !== value) record.element.setAttribute(name, value);
      }
      for (const name of Object.keys(record.attributes)) {
        if (!(name in object.attributes)) record.element.removeAttribute(name);
      }
      record.attributes = object.attributes;
      if (record.body !== object.body) {
        scratch.innerHTML = object.body;
        record.element.replaceChildren(...Array.from(scratch.childNodes));
        record.body = object.body;
      }
      // Keep paint order without moving elements that are already in place.
      const expectedNext: Element | null = previous ? previous.nextElementSibling : world.firstElementChild;
      if (expectedNext !== record.element) world.insertBefore(record.element, expectedNext);
      previous = record.element;
    }
  };

  update(frame);

  return {
    update,
    destroy: () => {
      records.clear();
      container.replaceChildren();
    },
  };
}
