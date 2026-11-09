import { describe, expect, it } from "vitest";
import { createDiagnosticCollector, ValidationBudgetExceeded, VALIDATION_LIMITS } from "../src/validation-budget.js";

describe("diagnostic collector exhaustion", () => {
  for (const count of [VALIDATION_LIMITS.diagnostics - 1, VALIDATION_LIMITS.diagnostics + 20]) {
    it(`does not mutate after exhaustion when initially collecting ${count} diagnostics`, () => {
      const diagnostics = createDiagnosticCollector();
      const items = Array.from({ length: count }, (_, index) => ({ code: "INVALID_SCENE", path: `objects[${index}]`, message: "Invalid object." }));
      if (count < VALIDATION_LIMITS.diagnostics) {
        diagnostics.push(...items);
        expect(() => diagnostics.push(items[0]!)).toThrow(ValidationBudgetExceeded);
      } else {
        expect(() => diagnostics.push(...items)).toThrow(ValidationBudgetExceeded);
      }
      const snapshot = diagnostics.slice();
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(() => diagnostics.push(items[0]!)).toThrow(ValidationBudgetExceeded);
        expect(diagnostics).toEqual(snapshot);
      }
      expect(diagnostics).toHaveLength(VALIDATION_LIMITS.diagnostics);
      expect(diagnostics.filter(item => item.code === "LIMIT_DIAGNOSTICS")).toHaveLength(1);
    });
  }
});
