import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PACKAGE_FIXTURES } from "./fixtures.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACKAGES_DIR = path.join(ROOT, "packages");
const STANDARD_AUTO_INCLUDED = /^(?:readme(?:\..*)?|licen[cs]e(?:\..*)?|copying(?:\..*)?|notice(?:\..*)?|changelog(?:\..*)?|changes(?:\..*)?|history(?:\..*)?)$/i;
const FORBIDDEN_TARBALL_SEGMENTS = new Set([
  ".git",
  ".github",
  ".turbo",
  ".changeset",
  "node_modules",
  "src",
  "source",
  "test",
  "tests",
  "__tests__",
  "coverage",
]);
const FORBIDDEN_TARBALL_BASENAMES = [
  /^tsconfig(?:\..+)?\.json$/i,
  /^vitest(?:\..+)?\.config\.[cm]?[jt]s$/i,
  /^vite(?:\..+)?\.config\.[cm]?[jt]s$/i,
  /^eslint(?:\.config\.[cm]?[jt]s|rc(?:\..+)?)$/i,
  /^\.eslintrc(?:\..+)?$/i,
  /^pnpm-lock\.yaml$/i,
  /^pnpm-workspace\.yaml$/i,
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
];

const problems = [];
const notices = [];
let checkedPackages = 0;
let importedPackages = 0;
let packedPackages = 0;
let isolatedImports = 0;

function problem(packageName, code, message) {
  problems.push({ packageName, code, message });
}

function notice(message) {
  notices.push(message);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isSafePackageRelative(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return !parts.includes("..") && !normalized.startsWith("../");
}

function stripDotSlash(value) {
  return value.startsWith("./") ? value.slice(2) : value;
}

function hasPattern(value) {
  return /[*?]/.test(value);
}

function globRegex(pattern) {
  const normalized = stripDotSlash(pattern).replaceAll("\\", "/");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(source + "$");
}

async function listPackageEntries(packageDir) {
  const output = [];
  async function visit(current, relative) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      output.push(nextRelative);
      if (entry.isDirectory()) {
        await visit(path.join(current, entry.name), nextRelative);
      }
    }
  }
  await visit(packageDir, "");
  return output;
}

function collectExportTargets(value, label = "exports", output = []) {
  if (typeof value === "string") {
    output.push({ label, target: value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectExportTargets(entry, `${label}[${index}]`, output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const childLabel = key.startsWith(".") ? `${label}[${JSON.stringify(key)}]` : `${label}.${key}`;
      collectExportTargets(entry, childLabel, output);
    }
  }
  return output;
}

function rootExportValue(exportsField) {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) return exportsField;
  if (!exportsField || typeof exportsField !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(exportsField, ".")) return exportsField["."];
  const keys = Object.keys(exportsField);
  if (keys.length > 0 && keys.every(key => !key.startsWith("."))) return exportsField;
  return undefined;
}

function conditionTarget(value, preferredCondition) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = conditionTarget(entry, preferredCondition);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, preferredCondition)) {
    const found = conditionTarget(value[preferredCondition], preferredCondition);
    if (found) return found;
  }
  for (const fallback of ["node", "default"]) {
    if (Object.prototype.hasOwnProperty.call(value, fallback)) {
      const found = conditionTarget(value[fallback], preferredCondition);
      if (found) return found;
    }
  }
  return undefined;
}

function fileDeclarationCovers(files, target) {
  const relative = stripDotSlash(target).replaceAll("\\", "/");
  return files.some(entry => {
    const declared = stripDotSlash(entry).replaceAll("\\", "/").replace(/\/$/, "");
    if (hasPattern(declared)) return globRegex(declared).test(relative);
    return relative === declared || relative.startsWith(`${declared}/`);
  });
}

async function verifyDeclaredFiles(packageName, packageDir, files, packageEntries) {
  if (!Array.isArray(files) || files.length === 0) {
    problem(packageName, "FILES_MISSING", "package.json must declare a non-empty files array.");
    return;
  }

  for (const [index, entry] of files.entries()) {
    if (!isSafePackageRelative(entry)) {
      problem(packageName, "FILES_INVALID", `files[${index}] must be a safe package-relative path; received ${JSON.stringify(entry)}.`);
      continue;
    }

    const relative = stripDotSlash(entry).replaceAll("\\", "/");
    if (hasPattern(relative)) {
      const matcher = globRegex(relative);
      if (!packageEntries.some(candidate => matcher.test(candidate))) {
        problem(packageName, "FILES_PATTERN_EMPTY", `files entry '${entry}' matches no built package content.`);
      }
      continue;
    }

    if (!(await exists(path.join(packageDir, relative)))) {
      problem(packageName, "FILES_TARGET_MISSING", `declared files entry '${entry}' does not exist after build.`);
    }
  }
}

async function verifyExports(packageName, packageDir, manifest, packageEntries) {
  if (manifest.exports === undefined) return;

  const targets = collectExportTargets(manifest.exports);
  if (targets.length === 0) {
    problem(packageName, "EXPORTS_EMPTY", "exports is declared but contains no file targets.");
    return;
  }

  for (const { label, target } of targets) {
    if (!target.startsWith("./") || !isSafePackageRelative(target)) {
      problem(packageName, "EXPORT_TARGET_INVALID", `${label} must point to a safe './' package path; received ${JSON.stringify(target)}.`);
      continue;
    }

    const relative = stripDotSlash(target).replaceAll("\\", "/");
    if (hasPattern(relative)) {
      const matcher = globRegex(relative);
      if (!packageEntries.some(candidate => matcher.test(candidate))) {
        problem(packageName, "EXPORT_PATTERN_EMPTY", `${label} target '${target}' matches no built file.`);
      }
    } else if (!(await exists(path.join(packageDir, relative)))) {
      problem(packageName, "EXPORT_TARGET_MISSING", `${label} target '${target}' does not exist after build.`);
    }

    if (Array.isArray(manifest.files) && !fileDeclarationCovers(manifest.files, target)) {
      problem(packageName, "EXPORT_NOT_PUBLISHED", `${label} target '${target}' is not covered by package.json files.`);
    }

    if (relative.startsWith("dist/") && !packageEntries.includes(relative)) {
      problem(packageName, "DIST_EXPORT_MISSING", `built dist export '${target}' is missing.`);
    }
  }
}

function normalizeBins(bin, packageName) {
  if (typeof bin === "string") {
    const unscoped = packageName.includes("/") ? packageName.slice(packageName.lastIndexOf("/") + 1) : packageName;
    return [[unscoped, bin]];
  }
  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    return Object.entries(bin).filter(([, target]) => typeof target === "string");
  }
  return [];
}

async function verifyBins(packageName, packageDir, manifest) {
  for (const [binName, target] of normalizeBins(manifest.bin, packageName)) {
    if (!target.startsWith("./") || !isSafePackageRelative(target)) {
      problem(packageName, "BIN_TARGET_INVALID", `bin '${binName}' must point to a safe './' package path; received ${JSON.stringify(target)}.`);
      continue;
    }
    const relative = stripDotSlash(target).replaceAll("\\", "/");
    const absolute = path.join(packageDir, relative);
    if (!(await exists(absolute))) {
      problem(packageName, "BIN_TARGET_MISSING", `bin '${binName}' target '${target}' does not exist after build.`);
      continue;
    }
    if (Array.isArray(manifest.files) && !fileDeclarationCovers(manifest.files, target)) {
      problem(packageName, "BIN_NOT_PUBLISHED", `bin '${binName}' target '${target}' is not covered by package.json files.`);
    }
    const source = await readFile(absolute, "utf8");
    if (!source.startsWith("#!")) {
      problem(packageName, "BIN_SHEBANG_MISSING", `bin '${binName}' target '${target}' is missing a shebang.`);
    }
  }
}

async function readManifest(packageDir) {
  const file = path.join(packageDir, "package.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${toPosix(path.relative(ROOT, file))}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function discoverBuildablePackages() {
  const directories = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const result = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const packageDir = path.join(PACKAGES_DIR, directory.name);
    const manifestPath = path.join(packageDir, "package.json");
    if (!(await exists(manifestPath))) continue;
    const manifest = await readManifest(packageDir);
    if (typeof manifest.scripts?.build !== "string") continue;
    result.push({ directory: directory.name, packageDir, manifest });
  }
  return result.sort((a, b) => a.directory.localeCompare(b.directory));
}

async function runProcess(command, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args], {
          cwd,
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(command, args, {
          cwd,
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function tarString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8").trim();
}

function tarNumber(buffer, start, length) {
  const raw = tarString(buffer, start, length).replace(/\0/g, "").trim();
  if (!raw) return 0;
  return Number.parseInt(raw, 8);
}

function parsePax(data) {
  const values = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > data.length) break;
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals !== -1) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function parseTarball(buffer) {
  const tar = gunzipSync(buffer);
  const entries = [];
  let offset = 0;
  let nextPax = {};

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;

    const size = tarNumber(header, 124, 12);
    const mode = tarNumber(header, 100, 8);
    const type = String.fromCharCode(header[156] || 0);
    const prefix = tarString(header, 345, 155);
    const headerName = tarString(header, 0, 100);
    const rawName = prefix ? `${prefix}/${headerName}` : headerName;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`truncated tar entry ${rawName}`);

    const data = tar.subarray(dataStart, dataEnd);
    if (type === "x") {
      nextPax = parsePax(data);
    } else if (type !== "g") {
      entries.push({
        name: nextPax.path ?? rawName,
        linkName: nextPax.linkpath ?? tarString(header, 157, 100),
        mode,
        size,
        type,
        data: Buffer.from(data),
      });
      nextPax = {};
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

function packageTarPath(entryName) {
  const normalized = entryName.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "package") return "";
  if (!normalized.startsWith("package/")) return undefined;
  return normalized.slice("package/".length);
}

function safeTarRelative(relative) {
  return relative !== undefined &&
    relative !== "" &&
    !relative.startsWith("/") &&
    !relative.split("/").includes("..");
}

function isRegularTarEntry(entry) {
  return entry.type === "\0" || entry.type === "0" || entry.type === "";
}

function tarEntryMap(entries) {
  const result = new Map();
  for (const entry of entries) {
    const relative = packageTarPath(entry.name);
    if (relative !== undefined && relative !== "") result.set(relative, entry);
  }
  return result;
}

function forbiddenTarballReason(relative) {
  const normalized = relative.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some(segment => FORBIDDEN_TARBALL_SEGMENTS.has(segment.toLowerCase()))) {
    return "source/test/workspace directory";
  }
  const basename = segments.at(-1) ?? "";
  if (FORBIDDEN_TARBALL_BASENAMES.some(pattern => pattern.test(basename))) {
    return "workspace/build configuration";
  }
  if (/\.(?:ts|tsx|mts|cts)$/i.test(basename) && !/\.d\.(?:ts|mts|cts)$/i.test(basename)) {
    return "raw TypeScript source";
  }
  return undefined;
}

function manifestPublicTargets(manifest) {
  const exportTargets = collectExportTargets(manifest.exports);
  const runtime = new Set();
  const types = new Set();

  for (const { label, target } of exportTargets) {
    if (typeof target !== "string" || hasPattern(target)) continue;
    const relative = stripDotSlash(target).replaceAll("\\", "/");
    if (label.endsWith(".types")) types.add(relative);
    else runtime.add(relative);
  }

  for (const field of ["main", "module", "browser"]) {
    if (typeof manifest[field] === "string") runtime.add(stripDotSlash(manifest[field]).replaceAll("\\", "/"));
  }
  for (const field of ["types", "typings"]) {
    if (typeof manifest[field] === "string") types.add(stripDotSlash(manifest[field]).replaceAll("\\", "/"));
  }
  for (const [, target] of normalizeBins(manifest.bin, manifest.name ?? "")) {
    runtime.add(stripDotSlash(target).replaceAll("\\", "/"));
  }

  return { runtime, types };
}

function directDistOutput(relative) {
  if (!relative.startsWith("dist/")) return false;
  return relative.slice("dist/".length).split("/").length === 1;
}

function verifyPackedOutputCoverage(packageName, manifest, entryMap) {
  const { runtime, types } = manifestPublicTargets(manifest);

  for (const relative of entryMap.keys()) {
    if (!directDistOutput(relative)) continue;

    if (/\.d\.(?:ts|mts|cts)$/i.test(relative)) {
      if (!types.has(relative)) {
        problem(packageName, "SHIPPED_TYPES_UNREFERENCED", `shipped declaration '${relative}' is not referenced by exports.types or package.json types/typings.`);
      }
      continue;
    }

    if (/\.(?:js|mjs|cjs)$/i.test(relative) && !runtime.has(relative)) {
      problem(packageName, "SHIPPED_RUNTIME_UNREFERENCED", `shipped runtime entry '${relative}' is not referenced by exports/main/module/browser or bin.`);
    }
  }
}

function verifyPackedDependencyProtocols(packageName, manifest) {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const values = manifest[field];
    if (!values || typeof values !== "object") continue;
    for (const [name, version] of Object.entries(values)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        problem(packageName, "PACKED_WORKSPACE_PROTOCOL", `${field}.${name} still uses '${version}' in the packed package.json.`);
      }
    }
  }
}

function verifyPackedManifestDrift(packageName, sourceManifest, packedManifest) {
  for (const field of ["name", "version", "type", "files", "exports", "types", "typings", "bin"]) {
    if (JSON.stringify(sourceManifest[field]) !== JSON.stringify(packedManifest[field])) {
      problem(packageName, "PACKED_MANIFEST_FIELD_DRIFT", `pnpm pack changed package.json field '${field}' unexpectedly.`);
    }
  }
}

function verifyTarballEntries(packageName, manifest, entries) {
  const entryMap = tarEntryMap(entries);
  if (!entryMap.has("package.json")) {
    problem(packageName, "TARBALL_MANIFEST_MISSING", "actual tarball does not contain package.json.");
    return entryMap;
  }

  for (const entry of entries) {
    const relative = packageTarPath(entry.name);
    if (relative === undefined) {
      problem(packageName, "TARBALL_PATH_INVALID", `tarball entry '${entry.name}' is outside the package/ prefix.`);
      continue;
    }
    if (relative === "") continue;
    if (!safeTarRelative(relative)) {
      problem(packageName, "TARBALL_PATH_UNSAFE", `tarball entry '${entry.name}' is not a safe package-relative path.`);
      continue;
    }

    if (entry.type === "2" || entry.type === "1") {
      problem(packageName, "TARBALL_LINK_REJECTED", `tarball entry '${relative}' is a link; release packages should contain regular files/directories only.`);
      continue;
    }

    if (!isRegularTarEntry(entry) && entry.type !== "5") {
      problem(packageName, "TARBALL_ENTRY_TYPE", `tarball entry '${relative}' has unsupported tar type ${JSON.stringify(entry.type)}.`);
    }

    if (!isRegularTarEntry(entry)) continue;

    const reason = forbiddenTarballReason(relative);
    if (reason) {
      problem(packageName, "TARBALL_ACCIDENTAL_FILE", `tarball unexpectedly ships '${relative}' (${reason}).`);
    }

    const basename = relative.split("/").at(-1) ?? "";
    const automatic = relative === "package.json" || (relative.split("/").length === 1 && STANDARD_AUTO_INCLUDED.test(basename));
    if (!automatic && Array.isArray(manifest.files) && !fileDeclarationCovers(manifest.files, relative)) {
      problem(packageName, "TARBALL_FILE_NOT_DECLARED", `actual tarball ships '${relative}' even though package.json files does not cover it.`);
    }
  }

  if (Array.isArray(manifest.files)) {
    for (const declared of manifest.files) {
      if (!isSafePackageRelative(declared)) continue;
      const normalized = stripDotSlash(declared).replaceAll("\\", "/").replace(/\/$/, "");
      if (hasPattern(normalized)) {
        const matcher = globRegex(normalized);
        if (![...entryMap.keys()].some(entry => matcher.test(entry))) {
          problem(packageName, "PACKED_FILES_PATTERN_EMPTY", `files entry '${declared}' matches nothing in the actual tarball.`);
        }
      } else if (![...entryMap.keys()].some(entry => entry === normalized || entry.startsWith(`${normalized}/`))) {
        problem(packageName, "PACKED_FILES_TARGET_MISSING", `files entry '${declared}' is absent from the actual tarball.`);
      }
    }
  }

  for (const { label, target } of collectExportTargets(manifest.exports)) {
    if (typeof target !== "string" || hasPattern(target) || !target.startsWith("./") || !isSafePackageRelative(target)) continue;
    const relative = stripDotSlash(target).replaceAll("\\", "/");
    if (!entryMap.has(relative)) {
      problem(packageName, "PACKED_EXPORT_MISSING", `${label} target '${target}' is absent from the actual tarball.`);
    }
  }

  for (const field of ["types", "typings"]) {
    const target = manifest[field];
    if (typeof target !== "string" || hasPattern(target) || !isSafePackageRelative(target)) continue;
    const relative = stripDotSlash(target).replaceAll("\\", "/");
    if (!entryMap.has(relative)) {
      problem(packageName, "PACKED_TYPES_MISSING", `package.json ${field} target '${target}' is absent from the actual tarball.`);
    }
  }

  for (const [binName, target] of normalizeBins(manifest.bin, manifest.name ?? packageName)) {
    if (!target.startsWith("./") || !isSafePackageRelative(target)) continue;
    const relative = stripDotSlash(target).replaceAll("\\", "/");
    const entry = entryMap.get(relative);
    if (!entry) {
      problem(packageName, "PACKED_BIN_MISSING", `bin '${binName}' target '${target}' is absent from the actual tarball.`);
      continue;
    }
    if (!isRegularTarEntry(entry)) {
      problem(packageName, "PACKED_BIN_NOT_FILE", `bin '${binName}' target '${target}' is not a regular tarball file.`);
      continue;
    }
    if ((entry.mode & 0o111) === 0) {
      problem(packageName, "PACKED_BIN_NOT_EXECUTABLE", `bin '${binName}' target '${target}' is not executable in the tarball (mode ${entry.mode.toString(8)}).`);
    }
    if (!entry.data.toString("utf8").startsWith("#!")) {
      problem(packageName, "PACKED_BIN_SHEBANG_MISSING", `bin '${binName}' target '${target}' is missing a shebang in the actual tarball.`);
    }
  }

  verifyPackedOutputCoverage(packageName, manifest, entryMap);
  return entryMap;
}

async function packPackage(packageInfo, tarballsDir) {
  const packageName = typeof packageInfo.manifest.name === "string"
    ? packageInfo.manifest.name
    : `packages/${packageInfo.directory}`;

  const result = await runProcess("pnpm", ["pack", "--json", "--pack-destination", tarballsDir], packageInfo.packageDir);
  if (result.code !== 0) {
    problem(packageName, "PACK_FAILED", `pnpm pack failed with exit code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
    return undefined;
  }

  let packed;
  try {
    packed = JSON.parse(result.stdout);
  } catch (error) {
    problem(packageName, "PACK_OUTPUT_INVALID", `pnpm pack --json returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  const filename = typeof packed.filename === "string" ? packed.filename : undefined;
  if (!filename) {
    problem(packageName, "PACK_FILENAME_MISSING", "pnpm pack --json did not report a tarball filename.");
    return undefined;
  }

  const tarballPath = path.isAbsolute(filename) ? filename : path.join(tarballsDir, filename);
  if (!(await exists(tarballPath))) {
    problem(packageName, "PACK_TARBALL_MISSING", `pnpm pack reported '${filename}', but the tarball does not exist.`);
    return undefined;
  }

  let entries;
  try {
    entries = parseTarball(await readFile(tarballPath));
  } catch (error) {
    problem(packageName, "TARBALL_PARSE_FAILED", `could not parse actual tarball: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  const entryMap = tarEntryMap(entries);
  const manifestEntry = entryMap.get("package.json");
  if (!manifestEntry || !isRegularTarEntry(manifestEntry)) {
    verifyTarballEntries(packageName, packageInfo.manifest, entries);
    return undefined;
  }

  let packedManifest;
  try {
    packedManifest = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch (error) {
    problem(packageName, "PACKED_MANIFEST_INVALID", `packed package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  packedPackages += 1;
  verifyPackedManifestDrift(packageName, packageInfo.manifest, packedManifest);
  verifyPackedDependencyProtocols(packageName, packedManifest);
  verifyTarballEntries(packageName, packedManifest, entries);

  return {
    ...packageInfo,
    packageName,
    tarballPath,
    entries,
    entryMap,
    packedManifest,
  };
}

function installDirectoryForPackage(isolatedRoot, packageName) {
  const segments = packageName.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe package name ${JSON.stringify(packageName)}`);
  }
  return path.join(isolatedRoot, "node_modules", ...segments);
}

async function extractPackedPackage(packed, isolatedRoot) {
  const destination = installDirectoryForPackage(isolatedRoot, packed.packageName);
  await mkdir(destination, { recursive: true });

  for (const entry of packed.entries) {
    const relative = packageTarPath(entry.name);
    if (!safeTarRelative(relative)) continue;
    const absolute = path.join(destination, ...relative.split("/"));
    if (entry.type === "5") {
      await mkdir(absolute, { recursive: true });
      continue;
    }
    if (!isRegularTarEntry(entry)) continue;

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, entry.data);
    if (process.platform !== "win32") {
      await chmod(absolute, entry.mode & 0o777);
    }
  }

  return destination;
}

async function dynamicImportSmoke(fixture, packageDir, manifest) {
  const rootExport = rootExportValue(manifest.exports);
  if (rootExport === undefined) {
    problem(fixture.packageName, "ROOT_EXPORT_MISSING", "SSR import fixture requires a root '.' export.");
    return;
  }
  const importTarget = conditionTarget(rootExport, "import");
  if (!importTarget) {
    problem(fixture.packageName, "IMPORT_CONDITION_MISSING", "root export does not provide an import/default target.");
    return;
  }
  if (hasPattern(importTarget) || !importTarget.startsWith("./") || !isSafePackageRelative(importTarget)) {
    problem(fixture.packageName, "IMPORT_TARGET_INVALID", `cannot smoke-import root target ${JSON.stringify(importTarget)}.`);
    return;
  }

  const absolute = path.join(packageDir, stripDotSlash(importTarget));
  if (!(await exists(absolute))) return;

  try {
    const namespace = await import(pathToFileURL(absolute).href);
    importedPackages += 1;
    for (const symbol of fixture.requiredRuntimeExports ?? []) {
      if (!(symbol in namespace)) {
        problem(fixture.packageName, "RUNTIME_EXPORT_MISSING", `expected runtime export '${symbol}' is absent from the built root module.`);
      }
    }
  } catch (error) {
    problem(
      fixture.packageName,
      "SSR_IMPORT_FAILED",
      `built root module failed to import in plain Node: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
  }
}

function externalRuntimeDependencies(manifest, packedNames) {
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}).filter(name => !manifest.peerDependenciesMeta?.[name]?.optional),
  ]);
  return [...names].filter(name => !packedNames.has(name)).sort();
}

async function isolatedImportSmoke(packed, isolatedRoot, packedNames, requiredRuntimeExports = []) {
  const external = externalRuntimeDependencies(packed.packedManifest, packedNames);
  if (external.length > 0) {
    notice(`isolated tarball import for ${packed.packageName} skipped because external runtime/peer dependencies are not installed: ${external.join(", ")}`);
    return;
  }

  const rootExport = rootExportValue(packed.packedManifest.exports);
  if (rootExport === undefined) return;
  const importTarget = conditionTarget(rootExport, "import");
  if (!importTarget || hasPattern(importTarget) || !importTarget.startsWith("./") || !isSafePackageRelative(importTarget)) return;

  const installDir = installDirectoryForPackage(isolatedRoot, packed.packageName);
  const absolute = path.join(installDir, stripDotSlash(importTarget));
  if (!(await exists(absolute))) return;

  try {
    const namespace = await import(pathToFileURL(absolute).href);
    isolatedImports += 1;
    for (const symbol of requiredRuntimeExports) {
      if (!(symbol in namespace)) {
        problem(packed.packageName, "ISOLATED_RUNTIME_EXPORT_MISSING", `tarball-like isolated import is missing runtime export '${symbol}'.`);
      }
    }
  } catch (error) {
    problem(
      packed.packageName,
      "ISOLATED_IMPORT_FAILED",
      `unpacked tarball-like root module failed to import in isolated node_modules: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
  }
}

async function verifyFixture(fixture, discoveredByDirectory) {
  const packageInfo = discoveredByDirectory.get(fixture.directory);
  if (!packageInfo) {
    if (fixture.required) {
      problem(fixture.packageName, "PACKAGE_MISSING", `required package directory packages/${fixture.directory} is absent or has no build script.`);
    } else {
      notice(`optional package ${fixture.packageName} is not present; skipped focused checks`);
    }
    return;
  }

  const { packageDir, manifest } = packageInfo;
  if (manifest.name !== fixture.packageName) {
    problem(fixture.packageName, "PACKAGE_NAME_MISMATCH", `packages/${fixture.directory} declares name ${JSON.stringify(manifest.name)}.`);
  }

  if (fixture.rootExportRequired !== false) {
    const rootExport = rootExportValue(manifest.exports);
    if (rootExport === undefined) {
      problem(fixture.packageName, "ROOT_EXPORT_MISSING", "expected a public root '.' export.");
    } else {
      const typesTarget = conditionTarget(rootExport, "types");
      if (!typesTarget) {
        problem(fixture.packageName, "TYPES_EXPORT_MISSING", "root export should declare a types target.");
      }
      const importTarget = conditionTarget(rootExport, "import");
      if (!importTarget) {
        problem(fixture.packageName, "IMPORT_CONDITION_MISSING", "root export should declare an import/default target.");
      }
    }
  }

  if (fixture.bin) {
    const bins = new Map(normalizeBins(manifest.bin, manifest.name ?? fixture.packageName));
    if (!bins.has(fixture.bin)) {
      problem(fixture.packageName, "EXPECTED_BIN_MISSING", `expected bin '${fixture.bin}' is not declared.`);
    }
  }

  if (fixture.nodeImport) {
    await dynamicImportSmoke(fixture, packageDir, manifest);
  }
}

async function main() {
  const discovered = await discoverBuildablePackages();
  const discoveredByDirectory = new Map(discovered.map(info => [info.directory, info]));

  for (const { packageDir, manifest } of discovered) {
    const packageName = typeof manifest.name === "string" ? manifest.name : toPosix(path.relative(ROOT, packageDir));
    checkedPackages += 1;
    const packageEntries = await listPackageEntries(packageDir);
    await verifyDeclaredFiles(packageName, packageDir, manifest.files, packageEntries);
    await verifyExports(packageName, packageDir, manifest, packageEntries);
    await verifyBins(packageName, packageDir, manifest);
  }

  for (const fixture of PACKAGE_FIXTURES) {
    await verifyFixture(fixture, discoveredByDirectory);
  }

  let temporaryRoot;
  try {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "anim8-packaging-"));
    const tarballsDir = path.join(temporaryRoot, "tarballs");
    const isolatedRoot = path.join(temporaryRoot, "isolated");
    await mkdir(tarballsDir, { recursive: true });
    await mkdir(path.join(isolatedRoot, "node_modules"), { recursive: true });

    const packedByDirectory = new Map();
    for (const packageInfo of discovered) {
      const packed = await packPackage(packageInfo, tarballsDir);
      if (packed) {
        packedByDirectory.set(packageInfo.directory, packed);
        await extractPackedPackage(packed, isolatedRoot);
      }
    }

    const packedNames = new Set([...packedByDirectory.values()].map(info => info.packageName));
    const fixtureByDirectory = new Map(PACKAGE_FIXTURES.map(fixture => [fixture.directory, fixture]));
    for (const [directory, packed] of packedByDirectory) {
      const fixture = fixtureByDirectory.get(directory);
      await isolatedImportSmoke(
        packed,
        isolatedRoot,
        packedNames,
        fixture?.nodeImport ? (fixture.requiredRuntimeExports ?? []) : [],
      );
    }
  } catch (error) {
    problem("workspace", "TARBALL_QUALIFICATION_FAILED", error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    if (temporaryRoot) {
      try {
        await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch (error) {
        problem("workspace", "TEMP_CLEANUP_FAILED", `could not remove packaging temp directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const message of notices) console.log(`[packaging] NOTE: ${message}`);

  if (problems.length > 0) {
    console.error(`[packaging] FAILED: ${problems.length} packaging problem${problems.length === 1 ? "" : "s"} found.`);
    for (const item of problems) {
      console.error(`- [${item.packageName}] ${item.code}: ${item.message}`);
    }
    console.error("[packaging] No manifests were modified. Fix the reported package/build output and rerun after pnpm build.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `[packaging] OK: checked ${checkedPackages} buildable package manifests; packed and inspected ${packedPackages} actual tarballs; ${importedPackages} built Node/SSR imports and ${isolatedImports} isolated tarball imports passed.`,
  );
}

await main();
