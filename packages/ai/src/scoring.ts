import type {
  BenchmarkCaseResult,
  BenchmarkScoreSummary,
  SchemaValidationScore,
  ValidationDiagnostic,
  ValidationResult,
} from "./types.js";

function countDiagnosticCodes(
  diagnostics: readonly ValidationDiagnostic[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const item of diagnostics) counts[item.code] = (counts[item.code] ?? 0) + 1;
  return Object.freeze({ ...counts });
}

/**
 * Binary schema/contract score. A candidate receives 1 only when it parsed as
 * JSON and the injected validator accepted it.
 */
export function scoreSchemaValidation(
  parseOk: boolean,
  validation: ValidationResult<unknown> | undefined,
  diagnostics: readonly ValidationDiagnostic[],
): SchemaValidationScore {
  const schemaValid = parseOk && validation?.ok === true;
  return {
    parseOk,
    schemaValid,
    score: schemaValid ? 1 : 0,
    diagnosticCount: diagnostics.length,
    diagnosticCodes: countDiagnosticCodes(diagnostics),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function summarizeBenchmark<T>(
  cases: readonly BenchmarkCaseResult<T>[],
): BenchmarkScoreSummary {
  const caseCount = cases.length;
  let successfulCases = 0;
  let firstPassValidCases = 0;
  let repairedValidCases = 0;
  let finalParseSuccesses = 0;
  let totalAttempts = 0;

  for (const result of cases) {
    totalAttempts += result.attempts.length;
    if (result.success) successfulCases += 1;
    if (result.attempts[0]?.score.schemaValid) firstPassValidCases += 1;
    if (result.repaired) repairedValidCases += 1;
    if (result.finalAttempt.score.parseOk) finalParseSuccesses += 1;
  }

  return {
    caseCount,
    successfulCases,
    failedCases: caseCount - successfulCases,
    firstPassValidCases,
    repairedValidCases,
    parseSuccessRate: ratio(finalParseSuccesses, caseCount),
    schemaValidRate: ratio(successfulCases, caseCount),
    firstPassValidRate: ratio(firstPassValidCases, caseCount),
    averageAttemptsPerCase: ratio(totalAttempts, caseCount),
  };
}
