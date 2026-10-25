import { AGENT_SYSTEM_PROMPT } from "./fixtures.js";
import { measureJson, measureText } from "./metrics.js";
import { scoreSchemaValidation, summarizeBenchmark } from "./scoring.js";
import type {
  BenchmarkAttemptResult,
  BenchmarkCaseResult,
  BenchmarkPromptCase,
  BenchmarkSuiteResult,
  ModelGeneration,
  ModelGenerator,
  RepairContext,
  RunBenchmarkOptions,
  SchemaValidator,
  TokenUsage,
  ValidationDiagnostic,
} from "./types.js";

const MAX_REPAIR_DIAGNOSTICS = 24;
const MAX_ATTEMPTS = 10;

function normalizeGeneration(value: string | ModelGeneration): ModelGeneration {
  return typeof value === "string" ? { text: value } : value;
}

function parseCandidate(text: string):
  | { ok: true; value: unknown }
  | { ok: false; diagnostic: ValidationDiagnostic } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: "JSON_PARSE_ERROR",
        path: "$",
        message: "Model output is empty; return exactly one valid JSON value.",
      },
    };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code: "JSON_PARSE_ERROR",
        path: "$",
        message: "Model output must be exactly one valid JSON value with no Markdown or commentary.",
      },
    };
  }
}

function validateUsage(usage: TokenUsage | undefined): void {
  if (!usage) return;
  for (const [name, value] of Object.entries(usage)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))) {
      throw new RangeError(`Provider usage '${name}' must be a finite non-negative integer.`);
    }
  }
}

export function buildRepairInstruction(
  diagnostics: readonly ValidationDiagnostic[],
): string {
  const visible = diagnostics.slice(0, MAX_REPAIR_DIAGNOSTICS);
  const lines = [
    "Your previous Anim8 JSON failed validation.",
    "Return a complete replacement JSON object only, with no Markdown fences or explanation.",
    "Fix the validation issues below while preserving the requested scene:",
    ...visible.map(item => {
      const suggestion = item.suggestion ? ` Suggestion: ${item.suggestion}` : "";
      return `- [${item.code}] ${item.path}: ${item.message}${suggestion}`;
    }),
  ];
  if (diagnostics.length > visible.length) {
    lines.push(`- … ${diagnostics.length - visible.length} additional diagnostics omitted; make the replacement broadly schema-correct.`);
  }
  return lines.join("\n");
}

function repairContext(
  previous: BenchmarkAttemptResult<unknown>,
): RepairContext {
  return {
    previousOutput: previous.rawOutput,
    diagnostics: previous.diagnostics,
    instruction: buildRepairInstruction(previous.diagnostics),
  };
}

function normalizeMaxAttempts(value: number | undefined): number {
  const attempts = value ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    throw new RangeError(`maxAttempts must be an integer from 1 to ${MAX_ATTEMPTS}.`);
  }
  return attempts;
}

export async function runBenchmarkCase<T>(
  testCase: BenchmarkPromptCase,
  generate: ModelGenerator,
  validate: SchemaValidator<T>,
  options: RunBenchmarkOptions = {},
): Promise<BenchmarkCaseResult<T>> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const systemPrompt = options.systemPrompt ?? AGENT_SYSTEM_PROMPT;
  const attempts: BenchmarkAttemptResult<T>[] = [];

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const previous = attempts.at(-1);
    const generated = normalizeGeneration(await generate({
      caseId: testCase.id,
      systemPrompt,
      prompt: testCase.prompt,
      attempt: attemptNumber,
      ...(previous ? { repair: repairContext(previous) } : {}),
    }));
    validateUsage(generated.usage);

    const parsed = parseCandidate(generated.text);
    if (!parsed.ok) {
      const diagnostics = [parsed.diagnostic] as const;
      attempts.push({
        attempt: attemptNumber,
        rawOutput: generated.text,
        parseError: parsed.diagnostic,
        diagnostics,
        metrics: {
          output: measureText(generated.text, options.tokenCounter),
          ...(generated.usage ? { providerUsage: generated.usage } : {}),
        },
        score: scoreSchemaValidation(false, undefined, diagnostics),
        repairable: attemptNumber < maxAttempts,
      });
      continue;
    }

    const validation = await validate(parsed.value);
    const diagnostics = validation.diagnostics;
    const metrics = {
      output: measureText(generated.text, options.tokenCounter),
      json: measureJson(parsed.value),
      ...(generated.usage ? { providerUsage: generated.usage } : {}),
    };

    const result: BenchmarkAttemptResult<T> = {
      attempt: attemptNumber,
      rawOutput: generated.text,
      parsed: parsed.value,
      ...(validation.value !== undefined ? { validatedValue: validation.value } : {}),
      validation,
      diagnostics,
      metrics,
      score: scoreSchemaValidation(true, validation, diagnostics),
      repairable: !validation.ok && attemptNumber < maxAttempts,
    };
    attempts.push(result);
    if (validation.ok) break;
  }

  const finalAttempt = attempts.at(-1);
  if (!finalAttempt) throw new Error("Benchmark case completed without an attempt.");

  const success = finalAttempt.score.schemaValid;
  return {
    case: testCase,
    success,
    repaired: success && attempts.length > 1,
    attempts,
    finalAttempt,
  };
}

export async function runBenchmarkSuite<T>(
  cases: readonly BenchmarkPromptCase[],
  generate: ModelGenerator,
  validate: SchemaValidator<T>,
  options: RunBenchmarkOptions = {},
): Promise<BenchmarkSuiteResult<T>> {
  const results: BenchmarkCaseResult<T>[] = [];
  for (const testCase of cases) {
    results.push(await runBenchmarkCase(testCase, generate, validate, options));
  }

  return {
    resultVersion: 1,
    cases: results,
    summary: summarizeBenchmark(results),
  };
}
