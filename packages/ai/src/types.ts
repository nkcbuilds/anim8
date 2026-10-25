export type CapabilityTag =
  | "geometry"
  | "text"
  | "styling"
  | "motion"
  | "timing"
  | "connectors"
  | "groups"
  | "images"
  | "sketch-theme"
  | "visibility"
  | "multi-object"
  | "state"
  | "reactivity"
  | "camera"
  | "paths"
  | "morph"
  | "layout"
  | "state-machine"
  | "safety";

export interface BenchmarkPromptCase {
  /** Stable fixture id. Never derive this from array position. */
  id: string;
  /** Human-readable task only; provider-specific instructions belong in adapters. */
  prompt: string;
  /** Capabilities the prompt is intentionally exercising. */
  capabilityTags: readonly CapabilityTag[];
}

export interface ValidationDiagnostic {
  code: string;
  path: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult<T = unknown> {
  ok: boolean;
  value?: T;
  diagnostics: readonly ValidationDiagnostic[];
}

export type SchemaValidator<T = unknown> = (
  value: unknown,
) => ValidationResult<T> | Promise<ValidationResult<T>>;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelGeneration {
  text: string;
  /** Optional exact provider-reported usage. */
  usage?: TokenUsage;
  /** Optional provider/model label for reports; never interpreted by the harness. */
  model?: string;
  /** Opaque adapter-owned metadata. */
  metadata?: Readonly<Record<string, unknown>>;
}

export interface RepairContext {
  previousOutput: string;
  diagnostics: readonly ValidationDiagnostic[];
  instruction: string;
}

export interface GenerationRequest {
  caseId: string;
  systemPrompt: string;
  prompt: string;
  /** 1-based attempt number. */
  attempt: number;
  repair?: RepairContext;
}

export type ModelGenerator = (
  request: GenerationRequest,
) => string | ModelGeneration | Promise<string | ModelGeneration>;

export type TokenCounter = (text: string) => number;

export interface TextMetrics {
  characters: number;
  utf8Bytes: number;
  lines: number;
  /**
   * Deterministic fallback estimate based on UTF-8 bytes / 4.
   * This is not a provider tokenizer result.
   */
  estimatedTokens: number;
  /** Exact/custom tokenizer count when a counter is injected. */
  countedTokens?: number;
}

export interface JsonMetrics {
  serializedCharacters: number;
  serializedUtf8Bytes: number;
  objectKeys: number;
  arrayItems: number;
  maxDepth: number;
}

export interface AttemptMetrics {
  output: TextMetrics;
  json?: JsonMetrics;
  providerUsage?: TokenUsage;
}

export interface SchemaValidationScore {
  parseOk: boolean;
  schemaValid: boolean;
  /** Binary score: valid JSON + validator success. */
  score: 0 | 1;
  diagnosticCount: number;
  diagnosticCodes: Readonly<Record<string, number>>;
}

export interface BenchmarkAttemptResult<T = unknown> {
  attempt: number;
  rawOutput: string;
  parsed?: unknown;
  validatedValue?: T;
  parseError?: ValidationDiagnostic;
  validation?: ValidationResult<T>;
  diagnostics: readonly ValidationDiagnostic[];
  metrics: AttemptMetrics;
  score: SchemaValidationScore;
  /** True when another attempt may use diagnostics to repair the candidate. */
  repairable: boolean;
}

export interface BenchmarkCaseResult<T = unknown> {
  case: BenchmarkPromptCase;
  success: boolean;
  repaired: boolean;
  attempts: readonly BenchmarkAttemptResult<T>[];
  finalAttempt: BenchmarkAttemptResult<T>;
}

export interface BenchmarkSuiteResult<T = unknown> {
  resultVersion: 1;
  cases: readonly BenchmarkCaseResult<T>[];
  summary: BenchmarkScoreSummary;
}

export interface BenchmarkScoreSummary {
  caseCount: number;
  successfulCases: number;
  failedCases: number;
  firstPassValidCases: number;
  repairedValidCases: number;
  parseSuccessRate: number;
  schemaValidRate: number;
  firstPassValidRate: number;
  averageAttemptsPerCase: number;
}

export interface RunBenchmarkOptions {
  /** Total attempts including the first generation. Defaults to 3. */
  maxAttempts?: number;
  /** Optional exact/custom tokenizer. */
  tokenCounter?: TokenCounter;
  /** Override the shared agent-facing system prompt. */
  systemPrompt?: string;
}
