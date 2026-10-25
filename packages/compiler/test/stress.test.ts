import { describe, expect, it } from "vitest";
import { COMPILER_LIMITS, compile } from "../src/index.js";
import {
  generateInvalidScenes,
  generateValidScene,
} from "../../../tests/stress/generators.js";

describe("compiler deterministic stress/property coverage", () => {
  it("accepts seeded nested-group scenes with conflict-free random timelines", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const input = generateValidScene(seed);
      const result = compile(input);
      expect(result.ok, `seed ${seed}: ${JSON.stringify(result.diagnostics)}`).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(result.scene?.objects.some(object => object.type === "group" && object.parentId)).toBe(true);
    }
  });

  it("rejects seeded duplicate ids and malformed references deterministically", () => {
    for (let seed = 100; seed < 106; seed += 1) {
      for (const testCase of generateInvalidScenes(seed)) {
        const first = compile(testCase.scene);
        const second = compile(testCase.scene);

        expect(first.ok, `${testCase.name}, seed ${seed}`).toBe(false);
        expect(first.diagnostics, `${testCase.name}, seed ${seed}`).toEqual(second.diagnostics);
        expect(
          first.diagnostics.some(diagnostic => diagnostic.code === testCase.expectedCode),
          `${testCase.name}, seed ${seed}: ${JSON.stringify(first.diagnostics)}`,
        ).toBe(true);
      }
    }
  });

  it("handles bounded numeric edges and rejects non-finite/out-of-range numbers without throwing", () => {
    const atBoundary = generateValidScene(700);
    const leaf = atBoundary.objects.find(object => object.id === "leaf_0");
    expect(leaf).toBeDefined();
    const leafTransform = leaf?.transform as Record<string, unknown>;
    leafTransform.x = COMPILER_LIMITS.absoluteNumber;
    leafTransform.y = -COMPILER_LIMITS.absoluteNumber;

    const boundaryResult = compile(atBoundary);
    expect(boundaryResult.ok, JSON.stringify(boundaryResult.diagnostics)).toBe(true);

    const invalidNumbers = [
      { value: Number.NaN, code: "INVALID_TRANSFORM_VALUE" },
      { value: Number.POSITIVE_INFINITY, code: "INVALID_TRANSFORM_VALUE" },
      { value: COMPILER_LIMITS.absoluteNumber + 1, code: "INVALID_TRANSFORM_VALUE" },
      { value: -COMPILER_LIMITS.absoluteNumber - 1, code: "INVALID_TRANSFORM_VALUE" },
    ] as const;

    for (const { value, code } of invalidNumbers) {
      const scene = generateValidScene(701);
      const target = scene.objects.find(object => object.id === "leaf_0");
      expect(target).toBeDefined();
      (target?.transform as Record<string, unknown>).x = value;

      const result = compile(scene);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code }),
      );
    }

    const dimensionBoundary = generateValidScene(702);
    dimensionBoundary.scene.width = COMPILER_LIMITS.sceneDimension;
    dimensionBoundary.scene.height = 1;
    expect(compile(dimensionBoundary).ok).toBe(true);

    const dimensionOverflow = generateValidScene(703);
    dimensionOverflow.scene.width = COMPILER_LIMITS.sceneDimension + 1;
    dimensionOverflow.scene.height = 1;
    expect(compile(dimensionOverflow).diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_SCENE_DIMENSION" }),
    );
  });
});
