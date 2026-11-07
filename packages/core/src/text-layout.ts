/**
 * Deterministic, DOM-free text fitting. Renderers supply a width measure for
 * their font; layout is a pure function of text, box and measure.
 */
export type TextMeasure = (text: string, fontSize: number) => number;

/** Average-advance estimate for common UI sans-serif fonts. */
export const estimateSansTextWidth: TextMeasure = (text, fontSize) => {
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.28;
    else if ("iljtfI.,:;'|!".includes(char)) units += 0.3;
    else if ("mwMW".includes(char)) units += 0.85;
    else if (char >= "A" && char <= "Z") units += 0.66;
    else units += 0.54;
  }
  return units * fontSize;
};

export interface TextFitOptions {
  maxWidth: number;
  maxHeight?: number;
  fontSize: number;
  /** Smallest size auto-fitting may shrink to. Defaults to 70% of fontSize. */
  minFontSize?: number;
  /** Line height as a multiple of font size. Defaults to 1.25. */
  lineHeight?: number;
  measure?: TextMeasure;
}

export interface TextFit {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** True when even the smallest size could not fit inside the box. */
  overflow: boolean;
}

/** Greedy word wrap. Explicit newlines are respected; long words are kept whole. */
export function wrapTextLines(text: string, maxWidth: number, fontSize: number, measure: TextMeasure = estimateSansTextWidth): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Wrap text into a box, shrinking the font in small steps until it fits both
 * width and height, but never below `minFontSize`.
 */
export function fitText(text: string, options: TextFitOptions): TextFit {
  const measure = options.measure ?? estimateSansTextWidth;
  const ratio = options.lineHeight ?? 1.25;
  const minimum = Math.min(options.fontSize, options.minFontSize ?? Math.max(10, options.fontSize * 0.7));
  const fits = (lines: string[], size: number) =>
    lines.every(line => measure(line, size) <= options.maxWidth) &&
    (options.maxHeight === undefined || lines.length * size * ratio <= options.maxHeight);

  let size = options.fontSize;
  for (;;) {
    const lines = wrapTextLines(text, options.maxWidth, size, measure);
    if (fits(lines, size)) return { lines, fontSize: size, lineHeight: size * ratio, overflow: false };
    const next = Math.max(minimum, Math.round((size - 1) * 100) / 100);
    if (next === size) return { lines, fontSize: size, lineHeight: size * ratio, overflow: true };
    size = next;
  }
}
