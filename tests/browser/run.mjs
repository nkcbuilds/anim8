import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const browserRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserRoot, "../..");

function isPlaywrightMissing(error) {
  return error?.code === "ERR_MODULE_NOT_FOUND" &&
    typeof error?.message === "string" &&
    error.message.includes("playwright");
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    if (!isPlaywrightMissing(error)) throw error;
    console.log(
      "SKIP browser harness: the 'playwright' package is not installed. " +
      "Install Playwright + Chromium, then rerun: node tests/browser/run.mjs",
    );
    return null;
  }
}

function runBuilds() {
  if (process.env.ANIM8_BROWSER_SKIP_BUILD === "1") return;

  const args = [
    "--filter", "@anim8/core",
    "--filter", "@anim8/a11y",
    "--filter", "@anim8/renderer-svg",
    "--filter", "@anim8/player",
    "--filter", "@anim8/react",
    "build",
  ];

  // When this runner is launched through pnpm, npm_execpath points at pnpm's
  // JavaScript entrypoint. Invoking it through the current Node executable
  // avoids Windows .cmd spawn quirks while remaining portable on Unix.
  const pnpmEntrypoint = process.env.npm_execpath;
  const result = pnpmEntrypoint
    ? spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env,
      })
    : spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env,
        shell: process.platform === "win32",
      });

  if (result.error) {
    throw new Error(
      `Browser harness prerequisite build could not start: ${result.error.message}`,
      { cause: result.error },
    );
  }
  assert.equal(
    result.status,
    0,
    "Browser harness prerequisite build failed for core/renderer-svg/player.",
  );
}

function assertBuiltOutputs() {
  for (const relative of [
    "packages/core/dist/index.js",
    "packages/a11y/dist/index.js",
    "packages/renderer-svg/dist/index.js",
    "packages/player/dist/index.js",
    "packages/react/dist/index.js",
  ]) {
    assert.ok(
      existsSync(resolve(repoRoot, relative)),
      `Missing ${relative}. Run the package builds or omit ANIM8_BROWSER_SKIP_BUILD=1.`,
    );
  }
}

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
]);

async function prepareReactHydrationFixture() {
  const tempDir = resolve(browserRoot, ".tmp");
  await mkdir(tempDir, { recursive: true });

  const [{ build }, React, serverRenderer, reactModule, sceneModule] = await Promise.all([
    import("esbuild"),
    import("react"),
    import("react-dom/server"),
    import(pathToFileURL(resolve(repoRoot, "packages/react/dist/index.js")).href),
    import(pathToFileURL(resolve(browserRoot, "react-hydration-scene.mjs")).href),
  ]);

  const element = React.createElement(reactModule.Anim8Player, {
    scene: sceneModule.hydrationScene,
    initialTime: 250,
  });
  const markup = serverRenderer.renderToStaticMarkup(element);

  await build({
    entryPoints: [resolve(browserRoot, "react-hydration-entry.mjs")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    outfile: resolve(tempDir, "react-hydration.js"),
    logLevel: "silent",
  });

  await writeFile(
    resolve(tempDir, "react-hydration.html"),
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Anim8 React hydration</title></head>
<body>
  <div id="react-hydration-root">${markup}</div>
  <script type="module" src="/tests/browser/.tmp/react-hydration.js"></script>
</body>
</html>`,
  );
}

async function startStaticServer() {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = resolve(repoRoot, relative || "tests/browser/fixture.html");
      const rootPrefix = repoRoot.endsWith(sep) ? repoRoot : repoRoot + sep;

      if (file !== repoRoot && !file.startsWith(rootPrefix)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!existsSync(file)) {
        response.writeHead(404).end("Not found");
        return;
      }

      response.setHeader("Content-Type", MIME.get(extname(file)) ?? "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      createReadStream(file)
        .on("error", error => {
          response.destroy(error);
        })
        .pipe(response);
    } catch {
      response.writeHead(400).end("Bad request");
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
    }),
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function runCase(name, callback) {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function launchBrowser(browserName, browserType) {
  try {
    return await browserType.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist") || message.includes("playwright install")) {
      console.log(
        `SKIP ${browserName}: Playwright is installed but its browser binary is unavailable. ` +
        `Install it with: pnpm exec playwright install ${browserName}`,
      );
      return null;
    }
    throw error;
  }
}

function requestedBrowserNames() {
  const supported = ["chromium", "firefox", "webkit"];
  const raw = process.env.ANIM8_BROWSER_ENGINES?.trim();
  if (!raw) return supported;

  const requested = [...new Set(raw.split(",").map(value => value.trim().toLowerCase()).filter(Boolean))];
  assert.ok(requested.length > 0, "ANIM8_BROWSER_ENGINES must contain at least one browser name.");
  for (const name of requested) {
    assert.ok(supported.includes(name), `Unsupported browser '${name}'. Use chromium, firefox, and/or webkit.`);
  }
  return requested;
}

async function runBrowserSuite(browserName, browserType, server) {
  const browser = await launchBrowser(browserName, browserType);
  if (!browser) return false;

  console.log(`INFO Playwright ${browserName} version=${browser.version()}`);
  const context = await browser.newContext({
    viewport: { width: 640, height: 480 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error));
  page.on("console", message => {
    if (message.type() === "error") {
      pageErrors.push(new Error(`${browserName} console error: ${message.text()}`));
    }
  });

  const caseName = name => `${browserName}: ${name}`;

  try {
    await page.goto(`${server.origin}/tests/browser/fixture.html`, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__anim8BrowserReady === true);

    await runCase(caseName("SVG mount/update preserves keyed DOM identity"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.svgIdentity());
      assert.equal(result.sameNode, true);
      assert.equal(result.sentinel, "same-node");
      assert.equal(result.svgCount, 1);
      assert.notEqual(result.beforeTransform, result.afterTransform);
    });

    await runCase(caseName("player play/pause/seek/reverse uses real requestAnimationFrame"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.playerControls());
      assert.equal(result.seekTime, 500);
      assert.ok(result.seekTransform?.includes("170"), "seek(500) should render the midpoint x position");
      assert.ok(result.afterPlay > 500, "play() should advance time");
      assert.equal(result.playingAfterPause, false);
      assert.equal(result.afterPauseWait, result.afterPlay, "pause() should stop time advancement");
      assert.ok(result.afterReverse < 900, "reverse() should move timeline time backward");
    });

    await runCase(caseName("dynamic connectors update in place as endpoints move"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.dynamicConnector());
      assert.equal(result.sameNode, true);
      assert.ok(result.before);
      assert.ok(result.after);
      assert.notEqual(result.before, result.after);
      assert.ok(result.movedTransform?.includes("250"));
    });

    await runCase(caseName("routed connectors recompute around moving obstacles"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.routedConnector());
      assert.equal(result.sameNode, true);
      assert.ok(result.before);
      assert.ok(result.after);
      assert.notEqual(result.before, result.after);
      assert.ok(result.before.includes("route") === false);
    });

    await runCase(caseName("responsive SVG sizing preserves semantic viewBox"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.responsiveSizing());
      assert.deepEqual(
        [result.beforeWidth, result.beforeHeight, result.afterWidth, result.afterHeight],
        [480, 270, 320, 180],
      );
      assert.equal(result.viewBoxBefore, "0 0 480 270");
      assert.equal(result.viewBoxAfter, result.viewBoxBefore);
    });

    await runCase(caseName("static renderer provides a useful no-player fallback"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.staticFallback());
      assert.equal(result.svgCount, 1);
      assert.equal(result.viewBox, "0 0 480 270");
      assert.ok(result.transform?.includes("170"));
      assert.equal(result.scriptCount, 0);
    });

    await runCase(caseName("prefers-reduced-motion prevents custom-element autoplay/play advancement"), async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const result = await page.evaluate(() => globalThis.__anim8Browser.reducedMotionCustomElement());
      assert.equal(result.mediaMatches, true);
      assert.equal(result.after, result.before);
      assert.equal(result.childrenAfterDisconnect, 0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
    });

    await runCase(caseName("hidden documents suspend playback without hidden-time catch-up"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.hiddenTabPolicy());
      assert.ok(result.beforeHide > 250);
      assert.equal(result.whileHidden, result.atHide);
      assert.ok(result.afterResume > result.whileHidden);
      assert.equal(result.playing, true);
    });

    await runCase(caseName("multiple player instances remain isolated"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.multipleInstances());
      assert.equal(result.firstTime, 250);
      assert.equal(result.secondTime, 750);
      assert.notEqual(result.firstTransform, result.secondTransform);
      assert.equal(result.distinctSvg, true);
      assert.equal(result.distinctObjectNode, true);
    });

    await runCase(caseName("mount/destroy/remount lifecycle cleans DOM"), async () => {
      const result = await page.evaluate(() => globalThis.__anim8Browser.mountUnmount());
      assert.equal(result.mountedChildren, 1);
      assert.equal(result.childrenAfterDestroy, 0);
      assert.equal(result.childrenAfterRemount, 1);
      assert.equal(result.childrenAfterSecondDestroy, 0);
      assert.ok(result.remountTransform?.includes("186"));
    });

    if (browserName === "chromium") {
      await runCase(caseName("deterministic screenshot fixture is byte-stable"), async () => {
        const fixtureInfo = await page.evaluate(() => globalThis.__anim8Browser.setupScreenshotFixture());
        assert.deepEqual(fixtureInfo, { width: 480, height: 270, objectCount: 4 });

        const locator = page.locator("#snapshot-root");
        const first = await locator.screenshot({ animations: "disabled" });

        await page.evaluate(() => globalThis.__anim8Browser.setupScreenshotFixture());
        const second = await page.locator("#snapshot-root").screenshot({ animations: "disabled" });

        assert.equal(Buffer.compare(first, second), 0, "Identical deterministic fixture screenshots must match byte-for-byte.");
        const hash = sha256(first);
        console.log(`INFO deterministic Chromium screenshot sha256=${hash}`);

        if (process.env.ANIM8_BROWSER_WRITE_SCREENSHOT === "1") {
          const artifactDir = resolve(browserRoot, "artifacts");
          await mkdir(artifactDir, { recursive: true });
          const output = resolve(artifactDir, "deterministic.chromium.png");
          await writeFile(output, first);
          console.log(`INFO wrote screenshot artifact: ${output}`);
        }
      });
    }

    await runCase(caseName("React SSR markup hydrates without replacement or recoverable errors"), async () => {
      await page.goto(`${server.origin}/tests/browser/.tmp/react-hydration.html`, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__anim8HydrationReady === true);
      const result = await page.evaluate(() => globalThis.__anim8HydrationResult);
      assert.equal(result.sameSvg, true);
      assert.equal(result.sameObject, true);
      assert.equal(result.svgCount, 1);
      assert.deepEqual(result.recoverableErrors, []);
      assert.ok(result.transform?.includes("170"), "hydrated initialTime=250 should preserve the SSR pose");
    });

    assert.equal(pageErrors.length, 0, pageErrors.map(error => error.message).join("\n"));
    const caseCount = browserName === "chromium" ? 12 : 11;
    console.log(`PASS browser harness (${browserName}, ${caseCount} cases)`);
    return true;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const playwright = await loadPlaywright();
  if (!playwright) return;

  runBuilds();
  assertBuiltOutputs();
  await prepareReactHydrationFixture();

  const requested = requestedBrowserNames();
  const requireAll = process.env.ANIM8_BROWSER_REQUIRE_ALL === "1";
  const server = await startStaticServer();
  const executed = [];
  const skipped = [];

  try {
    for (const browserName of requested) {
      const browserType = playwright[browserName];
      assert.ok(browserType, `Playwright does not expose browser type '${browserName}'.`);
      const ran = await runBrowserSuite(browserName, browserType, server);
      if (ran) executed.push(browserName);
      else skipped.push(browserName);
    }
  } finally {
    await server.close();
  }

  if (requireAll && skipped.length > 0) {
    throw new Error(`Required browser binaries are missing: ${skipped.join(", ")}.`);
  }

  if (executed.length === 0) {
    console.log("SKIP browser harness: none of the requested browser binaries are installed.");
    return;
  }

  console.log(
    `PASS browser matrix: executed ${executed.join(", ")}` +
    (skipped.length ? `; skipped missing ${skipped.join(", ")}` : ""),
  );
}

await main();
