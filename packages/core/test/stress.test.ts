import { describe, expect, it } from "vitest";
import {
  evaluate,
  sceneDuration,
  validateScene,
  worldMatrix,
  type DrawableObject,
  type SceneDocument,
} from "../src/index.js";
import {
  SeededRandom,
  generateValidScene,
} from "../../../tests/stress/generators.js";

function asScene(seed: number): SceneDocument {
  return generateValidScene(seed) as unknown as SceneDocument;
}

describe("core deterministic stress/property coverage", () => {
  it("is deterministic across repeated evaluate / serialize / evaluate cycles", () => {
    for (let seed = 1; seed <= 28; seed += 1) {
      const scene = asScene(seed);
      const originalJson = JSON.stringify(scene);
      const duration = sceneDuration(scene);
      const rng = new SeededRandom(seed * 7919);

      for (let sample = 0; sample < 6; sample += 1) {
        const time = duration === 0 ? 0 : rng.next() * duration;
        const first = evaluate(scene, time);
        const second = evaluate(scene, time);
        const roundTripped = JSON.parse(JSON.stringify(scene)) as SceneDocument;
        const afterRoundTrip = evaluate(roundTripped, time);

        expect(second, `repeat seed=${seed} sample=${sample}`).toEqual(first);
        expect(afterRoundTrip, `roundtrip seed=${seed} sample=${sample}`).toEqual(first);
        expect(JSON.stringify(afterRoundTrip)).toBe(JSON.stringify(first));
      }

      expect(JSON.stringify(scene), `evaluation mutated source scene for seed ${seed}`).toBe(originalJson);
    }
  });

  it("gives the same random-access frame regardless of evaluation order", () => {
    for (let seed = 40; seed < 52; seed += 1) {
      const scene = asScene(seed);
      const duration = sceneDuration(scene);
      const times = [0, duration * 0.17, duration * 0.43, duration * 0.81, duration];
      const canonical = new Map(times.map(time => [time, evaluate(scene, time)]));
      const order = [3, 0, 4, 1, 2] as const;

      for (const index of order) {
        const time = times[index]!;
        expect(evaluate(scene, time), `seed=${seed} time=${time}`).toEqual(canonical.get(time));
      }
    }
  });

  it("keeps generated nested-group transforms finite and validation conflict-free", () => {
    for (let seed = 80; seed < 96; seed += 1) {
      const scene = asScene(seed);
      expect(validateScene(scene), `seed ${seed}`).toEqual([]);

      const objects = new Map<string, DrawableObject>(
        scene.objects.map(object => [object.id, object]),
      );
      const nestedLeaf = scene.objects.find(object => object.parentId === "group_inner");
      expect(nestedLeaf).toBeDefined();

      const matrix = worldMatrix(nestedLeaf!, objects);
      for (const value of [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]) {
        expect(Number.isFinite(value), `seed ${seed} matrix=${JSON.stringify(matrix)}`).toBe(true);
      }
    }
  });
});
