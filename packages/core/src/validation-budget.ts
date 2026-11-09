import type { Diagnostic } from "./validate.js";

export const VALIDATION_LIMITS = Object.freeze({ diagnostics: 256, work: 1_000_000 });
export class ValidationBudgetExceeded extends Error {}
const budgets = new WeakMap<Diagnostic[], { work: number }>();

/** Internal bounded sink. Public validation results are copied into ordinary arrays. */
export function createDiagnosticCollector(): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let exhausted = false;
  budgets.set(diagnostics, { work: 0 });
  Object.defineProperty(diagnostics, "push", { value: (...items: Diagnostic[]) => {
    if (exhausted) throw new ValidationBudgetExceeded();
    if (diagnostics.length + items.length >= VALIDATION_LIMITS.diagnostics) {
      exhausted = true;
      Array.prototype.push.apply(diagnostics, items.slice(0, Math.max(0, VALIDATION_LIMITS.diagnostics - diagnostics.length - 1)));
      Array.prototype.push.call(diagnostics, { code: "LIMIT_DIAGNOSTICS", path: "$", message: "Validation stopped after reaching the diagnostic limit." });
      throw new ValidationBudgetExceeded();
    }
    return Array.prototype.push.apply(diagnostics, items);
  } });
  return diagnostics;
}

export function consumeValidationWork(diagnostics: Diagnostic[]): void {
  const budget = budgets.get(diagnostics);
  if (!budget || ++budget.work <= VALIDATION_LIMITS.work) return;
  diagnostics.push({ code: "LIMIT_VALIDATION_WORK", path: "$", message: "Validation exceeded its work budget." });
  throw new ValidationBudgetExceeded();
}
