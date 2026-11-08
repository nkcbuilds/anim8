import { VIRGIL_WOFF2_BASE64 } from "./font-data.js";
import { SKETCH_FONT_NAME } from "./font-name.js";

/** `@font-face` rule for the bundled font (~75 KB), for pages that load it themselves. */
export function sketchFontFaceCss(): string {
  return `@font-face{font-family:"${SKETCH_FONT_NAME}";src:url(data:font/woff2;base64,${VIRGIL_WOFF2_BASE64}) format("woff2");font-display:block}`;
}
