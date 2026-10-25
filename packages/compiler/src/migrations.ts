import type { Diagnostic } from "@anim8/core";

export const CURRENT_SCENE_VERSION = "1.0";
export const MAX_MIGRATION_STEPS = 32;

export interface SceneMigrationStep {
  from: string;
  to: string;
  /**
   * Trusted programmatic migration. Declarative scene files never provide or
   * execute migration functions.
   */
  migrate: (document: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

export interface MigrationSuccess {
  ok: true;
  document: Record<string, unknown>;
  applied: ReadonlyArray<{ from: string; to: string }>;
  diagnostics: [];
}

export interface MigrationFailure {
  ok: false;
  diagnostics: Diagnostic[];
}

export type MigrationResult = MigrationSuccess | MigrationFailure;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(code: string, path: string, message: string): MigrationFailure {
  return { ok: false, diagnostics: [{ code, path, message }] };
}

function cloneDocument(document: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(document);
}

/**
 * Migrates a JSON-compatible scene document through explicit trusted steps.
 *
 * Anim8 1.0 is the first stable scene-schema version, so there are no fabricated
 * built-in legacy formats. This utility is the stable migration boundary for
 * future schema versions and for applications that own pre-1.0 private formats.
 *
 * Migration functions are trusted application/library code; they are never
 * loaded from or executed out of untrusted scene JSON.
 */
export function migrateSceneVersion(
  input: unknown,
  options: {
    targetVersion?: string;
    migrations?: readonly SceneMigrationStep[];
  } = {},
): MigrationResult {
  if (!record(input)) {
    return failure("INVALID_MIGRATION_INPUT", "$", "Scene migration input must be a JSON object.");
  }

  const sourceVersion = input.version;
  if (typeof sourceVersion !== "string" || sourceVersion.length === 0) {
    return failure(
      "MISSING_SCENE_VERSION",
      "version",
      "Scene migration requires an explicit source version.",
    );
  }

  const targetVersion = options.targetVersion ?? CURRENT_SCENE_VERSION;
  if (typeof targetVersion !== "string" || targetVersion.length === 0) {
    return failure(
      "INVALID_TARGET_VERSION",
      "version",
      "Migration targetVersion must be a non-empty string.",
    );
  }

  if (sourceVersion === targetVersion) {
    return { ok: true, document: cloneDocument(input), applied: [], diagnostics: [] };
  }

  const migrations = options.migrations ?? [];
  const bySource = new Map<string, SceneMigrationStep[]>();
  for (const migration of migrations) {
    if (!migration.from || !migration.to || migration.from === migration.to) {
      return failure(
        "INVALID_MIGRATION_STEP",
        "version",
        "Migration steps require distinct non-empty from/to versions.",
      );
    }
    const entries = bySource.get(migration.from) ?? [];
    entries.push(migration);
    bySource.set(migration.from, entries);
  }
  for (const entries of bySource.values()) {
    entries.sort((a, b) => a.to.localeCompare(b.to));
  }

  type Search = { version: string; path: SceneMigrationStep[] };
  const queue: Search[] = [{ version: sourceVersion, path: [] }];
  const visited = new Set<string>([sourceVersion]);
  let path: SceneMigrationStep[] | undefined;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length >= MAX_MIGRATION_STEPS) continue;
    for (const step of bySource.get(current.version) ?? []) {
      const nextPath = [...current.path, step];
      if (step.to === targetVersion) {
        path = nextPath;
        queue.length = 0;
        break;
      }
      if (visited.has(step.to)) continue;
      visited.add(step.to);
      queue.push({ version: step.to, path: nextPath });
    }
  }

  if (!path) {
    return failure(
      "NO_MIGRATION_PATH",
      "version",
      `No migration path exists from scene version '${sourceVersion}' to '${targetVersion}'.`,
    );
  }

  let document = cloneDocument(input);
  const applied: Array<{ from: string; to: string }> = [];

  for (const step of path) {
    let migrated: Record<string, unknown>;
    try {
      migrated = step.migrate(Object.freeze(cloneDocument(document)));
    } catch (error) {
      return failure(
        "MIGRATION_FAILED",
        "version",
        `Migration '${step.from}' -> '${step.to}' failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!record(migrated)) {
      return failure(
        "INVALID_MIGRATION_OUTPUT",
        "version",
        `Migration '${step.from}' -> '${step.to}' must return an object.`,
      );
    }
    if (migrated.version !== step.to) {
      return failure(
        "INVALID_MIGRATION_VERSION",
        "version",
        `Migration '${step.from}' -> '${step.to}' must set version to '${step.to}'.`,
      );
    }

    document = cloneDocument(migrated);
    applied.push({ from: step.from, to: step.to });
  }

  return { ok: true, document, applied, diagnostics: [] };
}
