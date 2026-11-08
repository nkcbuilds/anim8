import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compileJson } from "../../packages/compiler/dist/index.js";
import { generateMedia } from "../../docs/media/generate.mjs";
import { readQuickstart, quickstartFrame } from "../../docs/media/quickstart.mjs";
import { readmeAnchors } from "./anchors.mjs";

test("builder boundaries survive multiline imports, comments, and CRLF", async () => {
  const source = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  const formatted = source
    .replace('import { scene } from "@anim8/authoring";', 'import {\n  scene,\n} from "@anim8/authoring";\n/* const player = unrelated comment */')
    .replace("const s = scene(", "/* const player = another comment */\nconst s = scene(");
  assert.deepEqual(readQuickstart(formatted.replace(/\r?\n/g, "\r\n")), readQuickstart(source));
  assert.throws(() => readQuickstart(source.replace("quickstart:builder:start", "missing-boundary")), /explicit builder boundaries/);
});

test("duplicate headings use numbered anchors and retain explicit IDs", () => {
  const markdown = '## Examples\n## Examples\n## Examples-1\n## Examples\n<a id="custom"></a>\n```md\n## Examples\n<a id="fake"></a>\n```';
  assert.deepEqual([...readmeAnchors(markdown)], ["examples", "examples-1", "examples-1-1", "examples-2", "custom"]);
});

test("the compiled authoring preview retains its nested SVG crop and placement in every chapter", () => {
  const result = compileJson(JSON.stringify(readQuickstart()));
  assert.ok(result.ok && !result.diagnostics.length);
  for (const time of [0, 2000, 5000, 8000]) {
    const roots = [...quickstartFrame(result.scene, time).matchAll(/<svg\b[^>]*>/g)].map(([tag]) => tag);
    assert.equal(roots.length, 2);
    for (const attribute of ['x="40"', 'y="76"', 'width="800"', 'height="230"', 'viewBox="80 100 560 160"']) {
      assert.ok(roots[1].includes(` ${attribute}`), `${time}: missing ${attribute}`);
    }
  }
});

async function withMediaDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "anim8-media-regression-"));
  try {
    for (const file of ["intro.gif", "intro.scene.json", "authoring.gif", "quickstart.scene.json"]) await writeFile(join(directory, file), `previous ${file}`);
    await writeFile(join(directory, "manifest.json"), JSON.stringify([{ file: "preserved.gif", sha256: "unchanged" }]));
    const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async file => [file, await readFile(join(directory, file), "utf8")])));
    await run(directory, snapshot);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()), "Test cleanup must stay in the temporary directory");
    await rm(directory, { recursive: true, force: true });
  }
}

// Fault injection exercises real staging/publication and OS file locks without
// requiring Chromium or FFmpeg in the docs-check CI step.
function fakeBrowser() {
  const browser = { closed: false, captures: 0, close: async () => { browser.closed = true; } };
  browser.newPage = async () => ({
    route: async () => {}, setViewportSize: async () => {}, setContent: async () => {}, evaluate: async () => {},
    screenshot: async ({ path }) => { browser.captures++; await writeFile(path, "frame fixture"); },
  });
  return browser;
}

test("concurrent regenerations cannot enter or overwrite outputs, and failure releases the lock", () => withMediaDirectory(async (directory, snapshot) => {
  const before = await snapshot();
  let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const first = generateMedia(["intro"], { directory, launchBrowser: async () => { started(); await barrier; throw new Error("launch failed"); } });
  const failed = assert.rejects(first, /launch failed/);
  try {
    await entered;
    let secondEntered = false;
    await assert.rejects(generateMedia(["authoring"], { directory, launchBrowser: async () => { secondEntered = true; } }), /already locked/);
    assert.equal(secondEntered, false);
  } finally { release(); await failed; }
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(generateMedia(["intro"], { directory, launchBrowser: async () => { throw new Error("retry reached browser"); } }), /retry reached browser/);
  assert.deepEqual(await snapshot(), before);
}));

test("an encoder failure after one successful render publishes neither scenes nor media nor manifest", () => withMediaDirectory(async (directory, snapshot) => {
  const before = await snapshot(), browser = fakeBrowser();
  let encodes = 0;
  await assert.rejects(generateMedia(["intro", "authoring"], {
    directory, launchBrowser: async () => browser,
    encode: async (_program, args) => {
      if (++encodes === 2) throw new Error("encoder failed");
      await writeFile(args.at(-1), "encoded but staged");
    },
  }), /encoder failed/);
  assert.equal(encodes, 2);
  assert.ok(browser.captures > 0);
  assert.equal(browser.closed, true);
  assert.deepEqual(await snapshot(), before);
}));

test("successful partial regenerations preserve other manifest entries and publish their matching sources", () => withMediaDirectory(async (directory, snapshot) => {
  for (const name of ["intro", "authoring"]) {
    const browser = fakeBrowser();
    await generateMedia([name], { directory, launchBrowser: async () => browser, encode: async (_program, args) => writeFile(args.at(-1), `encoded ${name}`) });
    assert.equal(browser.closed, true);
  }
  const files = await snapshot();
  const manifest = JSON.parse(files["manifest.json"]);
  assert.deepEqual(manifest[0], { file: "preserved.gif", sha256: "unchanged" });
  assert.deepEqual(manifest.slice(1).map(entry => entry.file), ["intro.gif", "authoring.gif"]);
  assert.deepEqual(JSON.parse(files["quickstart.scene.json"]), readQuickstart());
  assert.equal(JSON.parse(files["intro.scene.json"]).objects[0].id, "client");
  assert.deepEqual(Object.keys(files).sort(), ["authoring.gif", "intro.gif", "intro.scene.json", "manifest.json", "quickstart.scene.json"]);
}));
