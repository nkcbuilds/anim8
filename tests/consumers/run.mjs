import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const consumerRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const runtimeRoot = join(consumerRoot, ".runtime");
const runtimeNodeModules = join(runtimeRoot, "node_modules");
const fixtureSource = join(consumerRoot, "fixtures");
const fixtureRuntime = join(runtimeRoot, "fixtures");
const optionalSource = join(consumerRoot, "optional");
const optionalRuntime = join(runtimeRoot, "optional");

const workspacePackages = [
  "core",
  "renderer-svg",
  "player",
  "react",
];

function packageTarget(name) {
  return join(runtimeNodeModules, ...name.split("/"));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function copyPublishedPackage(directoryName) {
  const sourceRoot = join(repoRoot, "packages", directoryName);
  const packageJsonPath = join(sourceRoot, "package.json");
  const distPath = join(sourceRoot, "dist");
  const distEntry = join(distPath, "index.js");

  assert.ok(
    existsSync(packageJsonPath) && existsSync(distEntry),
    `Missing built output for packages/${directoryName}. Run "pnpm build" before this consumer suite.`,
  );

  const manifest = await readJson(packageJsonPath);
  assert.equal(typeof manifest.name, "string");

  const target = packageTarget(manifest.name);
  await mkdir(target, { recursive: true });
  await cp(packageJsonPath, join(target, "package.json"));
  await cp(distPath, join(target, "dist"), { recursive: true });
}

function resolvePackageJson(requireFrom, name) {
  try {
    return requireFrom.resolve(`${name}/package.json`);
  } catch {
    const entry = requireFrom.resolve(name);
    let current = dirname(entry);
    while (current !== dirname(current)) {
      const candidate = join(current, "package.json");
      if (existsSync(candidate)) return candidate;
      current = dirname(current);
    }
    throw new Error(`Unable to locate package.json for '${name}'.`);
  }
}

async function copyInstalledDependency(name, requireFrom, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);

  const packageJsonPath = resolvePackageJson(requireFrom, name);
  const sourceRoot = dirname(packageJsonPath);
  const manifest = await readJson(packageJsonPath);
  const target = packageTarget(name);

  await mkdir(dirname(target), { recursive: true });
  await cp(sourceRoot, target, {
    recursive: true,
    filter(source) {
      const local = relative(sourceRoot, source);
      if (!local) return true;
      return !local.split(sep).includes("node_modules");
    },
  });

  const nestedRequire = createRequire(packageJsonPath);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    await copyInstalledDependency(dependency, nestedRequire, seen);
  }
}

function runFixture(relativePath) {
  const entry = join(fixtureRuntime, relativePath);
  const result = spawnSync(process.execPath, [entry], {
    cwd: runtimeRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  assert.equal(
    result.status,
    0,
    `Consumer fixture '${relativePath}' failed with exit code ${String(result.status)}.`,
  );
}

function dependencyAvailable(requireFrom, name) {
  try {
    resolvePackageJson(requireFrom, name);
    return true;
  } catch {
    return false;
  }
}

function packageBinPath(requireFrom, packageName, binName) {
  const packageJsonPath = resolvePackageJson(requireFrom, packageName);
  const manifest = requireFrom(packageJsonPath);
  const bin = typeof manifest.bin === "string"
    ? manifest.bin
    : manifest.bin?.[binName] ?? manifest.bin?.[packageName];

  assert.equal(typeof bin, "string", `Package '${packageName}' does not expose expected bin '${binName}'.`);
  return join(dirname(packageJsonPath), bin);
}

function runFrameworkBuild(label, cliPath, cwd) {
  const result = spawnSync(process.execPath, [cliPath, "build"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      ASTRO_TELEMETRY_DISABLED: "1",
    },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  assert.equal(
    result.status,
    0,
    `${label} consumer build failed with exit code ${String(result.status)}.`,
  );
}

async function assertBuiltHtml(path, expected) {
  assert.ok(existsSync(path), `Expected framework build output at ${path}.`);
  const html = await readFile(path, "utf8");
  for (const value of expected) {
    assert.ok(html.includes(value), `Expected built HTML to contain '${value}'.`);
  }
}

async function runOptionalFrameworks() {
  const rootRequire = createRequire(join(repoRoot, "package.json"));
  let executed = 0;

  const nextMissing = ["next", "react", "react-dom"].filter(
    dependency => !dependencyAvailable(rootRequire, dependency),
  );
  if (nextMissing.length > 0) {
    console.log(
      `SKIP Next: buildable fixture at tests/consumers/optional/next; missing optional dependencies: ${nextMissing.join(", ")}.`,
    );
  } else {
    const cwd = join(optionalRuntime, "next");
    const cli = packageBinPath(rootRequire, "next", "next");
    runFrameworkBuild("Next", cli, cwd);
    await assertBuiltHtml(join(cwd, "out", "index.html"), [
      "Anim8 Next consumer fixture",
      "Anim8 Next fixture animation",
      "<svg",
    ]);
    executed += 1;
    console.log("PASS next-static-export");
  }

  const astroMissing = ["astro"].filter(
    dependency => !dependencyAvailable(rootRequire, dependency),
  );
  if (astroMissing.length > 0) {
    console.log(
      `SKIP Astro: buildable fixture at tests/consumers/optional/astro; missing optional dependencies: ${astroMissing.join(", ")}.`,
    );
  } else {
    const cwd = join(optionalRuntime, "astro");
    const cli = packageBinPath(rootRequire, "astro", "astro");
    runFrameworkBuild("Astro", cli, cwd);
    await assertBuiltHtml(join(cwd, "dist", "index.html"), [
      "Anim8 Astro consumer fixture",
      "Anim8 Astro fixture animation",
      "<svg",
    ]);
    executed += 1;
    console.log("PASS astro-static-build");
  }

  return executed;
}

async function main() {
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeNodeModules, { recursive: true });

  try {
    for (const directoryName of workspacePackages) {
      await copyPublishedPackage(directoryName);
    }

    // Supply React as a downstream peer, outside the copied @anim8/react package.
    const reactConsumerRequire = createRequire(
      join(repoRoot, "packages", "react", "package.json"),
    );
    await copyInstalledDependency("react", reactConsumerRequire);
    await copyInstalledDependency("react-dom", reactConsumerRequire);

    await cp(fixtureSource, fixtureRuntime, { recursive: true });
    await cp(optionalSource, optionalRuntime, { recursive: true });

    runFixture(join("vanilla-esm", "index.mjs"));
    runFixture(join("ssr-node", "index.mjs"));
    runFixture(join("react-ssr", "index.mjs"));

    const frameworkCount = await runOptionalFrameworks();
    console.log(`PASS consumer package-boundary suite (${3 + frameworkCount} executed fixtures)`);
  } finally {
    if (process.env.KEEP_CONSUMER_RUNTIME !== "1") {
      await rm(runtimeRoot, { recursive: true, force: true });
    } else {
      console.log(`INFO kept consumer runtime at ${runtimeRoot}`);
    }
  }
}

await main();
