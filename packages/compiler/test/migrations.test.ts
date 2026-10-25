import { describe, expect, it } from "vitest";
import { CURRENT_SCENE_VERSION, migrateSceneVersion } from "../src/index.js";

describe("scene schema migrations", () => {
  it("clones current-version documents without applying migrations", () => {
    const source = { version: CURRENT_SCENE_VERSION, scene: { width: 1, height: 1 } };
    const result = migrateSceneVersion(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([]);
    expect(result.document).toEqual(source);
    expect(result.document).not.toBe(source);
  });

  it("applies a deterministic multi-step trusted migration path", () => {
    const result = migrateSceneVersion(
      { version: "private-0", value: 2 },
      {
        migrations: [
          {
            from: "private-1",
            to: "1.0",
            migrate: document => ({ ...document, version: "1.0", value: Number(document.value) * 3 }),
          },
          {
            from: "private-0",
            to: "private-1",
            migrate: document => ({ ...document, version: "private-1", value: Number(document.value) + 1 }),
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([
      { from: "private-0", to: "private-1" },
      { from: "private-1", to: "1.0" },
    ]);
    expect(result.document).toEqual({ version: "1.0", value: 9 });
  });

  it("returns a structured diagnostic when no path exists", () => {
    const result = migrateSceneVersion({ version: "unknown" });
    expect(result).toEqual({
      ok: false,
      diagnostics: [{
        code: "NO_MIGRATION_PATH",
        path: "version",
        message: "No migration path exists from scene version 'unknown' to '1.0'.",
      }],
    });
  });

  it("rejects migration outputs that lie about their target version", () => {
    const result = migrateSceneVersion(
      { version: "private-0" },
      {
        migrations: [{
          from: "private-0",
          to: "1.0",
          migrate: document => ({ ...document, version: "wrong" }),
        }],
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("INVALID_MIGRATION_VERSION");
  });
});
