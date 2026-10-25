# Desktop WebView example

Anim8's runtime is browser-native and does not depend on Node.js APIs, so the same
bundle can be loaded inside Electron, Tauri, or another modern desktop WebView.

This example is intentionally the WebView payload rather than a second desktop
animation engine. The consumer qualification suite bundles the exact public
`@anim8/player` package boundary for `platform=browser`.

## Build

From a published-package application:

```bash
esbuild app.mjs --bundle --platform=browser --format=esm --outfile=dist/app.js
```

Then point the desktop shell at `index.html`.

### Electron

Create a normal Electron `BrowserWindow` with `nodeIntegration: false` and
load this directory's `index.html`. No Electron APIs are needed by Anim8.

### Tauri

Use this directory as the frontend distribution (or copy its built files into
your Tauri frontend output). Anim8 does not require a Tauri plugin.

Keeping the shell separate is deliberate: browser, Electron, Tauri, and other
WebViews all execute the same scene/player bundle, preserving one animation
runtime and one deterministic scene format.
