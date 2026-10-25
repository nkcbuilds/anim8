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

function reportOptionalFrameworkSkips() {
  const rootRequire = createRequire(join(repoRoot, "package.json"));
  const optional = [
    {
      name: "Next",
      fixture: "optional/next",
      dependencies: ["next"],
    },
    {
      name: "Astro + React",
      fixture: "optional/astro",
      dependencies: ["astro", "@astrojs/react"],
    },
  ];

  for (const framework of optional) {
    const missing = framework.dependencies.filter(
      (dependency) => !dependencyAvailable(rootRequire, dependency),
    );

    if (missing.length > 0) {
      console.log(
        `SKIP ${framework.name}: source/config fixture at tests/consumers/${framework.fixture}; missing optional dependencies: ${missing.join(", ")}.`,
      );
      continue;
    }

    console.log(
      `SKIP ${framework.name}: optional dependencies are present, but this lightweight runner intentionally does not claim a framework build was executed. Source/config fixture: tests/consumers/${framework.fixture}.`,
    );
  }
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

    runFixture(join("vanilla-esm", "index.mjs"));
    runFixture(join("ssr-node", "index.mjs"));
    runFixture(join("react-ssr", "index.mjs"));

    reportOptionalFrameworkSkips();
    console.log("PASS consumer package-boundary suite (3 executed fixtures)");
  } finally {
    if (process.env.KEEP_CONSUMER_RUNTIME !== "1") {
      await rm(runtimeRoot, { recursive: true, force: true });
    } else {
      console.log(`INFO kept consumer runtime at ${runtimeRoot}`);
    }
  }
}

await main();
