/** Collect ATX heading anchors, numbering collisions as GitHub does, plus explicit IDs. */
export function readmeAnchors(markdown) {
  const headings = new Set(), explicit = new Set();
  let fence;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = undefined;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    for (const match of line.matchAll(/<a id="([^"]+)"/g)) explicit.add(match[1]);
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/);
    if (!heading) continue;
    const base = heading[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    let anchor = base, suffix = 0;
    while (headings.has(anchor)) anchor = `${base}-${++suffix}`;
    headings.add(anchor);
  }
  return new Set([...headings, ...explicit]);
}
