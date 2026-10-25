import { describe, expect, it } from "vitest";
import {
  AGENT_SYSTEM_PROMPT,
  BENCHMARK_CASES,
  buildRepairInstruction,
  estimateTokens,
  getBenchmarkCase,
  measureJson,
  measureText,
  runBenchmarkCase,
  runBenchmarkSuite,
  scoreSchemaValidation,
  summarizeBenchmark,
  utf8Size,
  type GenerationRequest,
  type SchemaValidator,
  type ValidationResult,
} from "../src/index.js";

const expectedFixtureIds = [
  "basic-labeled-box",
  "circle-and-caption",
  "line-geometry",
  "simple-path",
  "move-card",
  "rotate-and-scale",
  "fade-and-highlight",
  "two-object-swap",
  "straight-connector",
  "orthogonal-connector-motion",
  "group-parenting",
  "sketch-theme",
  "relative-image",
  "https-image",
  "multi-stage-timeline",
  "connector-three-nodes",
  "routed-connector-obstacle",
  "camera-pan-zoom",
  "follow-polyline-path",
  "draw-path-progress",
  "compatible-path-morph",
  "ellipse-polygon-polyline",
  "nested-group-transform",
  "state-bound-position",
  "click-toggle-state",
  "custom-event-increment",
  "two-state-machine",
  "guarded-state-machine",
  "camera-and-object-concurrency",
  "explicit-interruption",
  "custom-cubic-bezier",
  "database-request-flow",
  "array-pointer-flow",
  "graph-traversal-highlight",
  "tree-parent-child-diagram",
  "reactive-visibility",
];

const sceneValidator: SchemaValidator<Record<string, unknown>> = value => {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).version === "1.0" &&
    Array.isArray((value as Record<string, unknown>).objects) &&
    Array.isArray((value as Record<string, unknown>).timeline)
  ) {
    return {
      ok: true,
      value: value as Record<string, unknown>,
      diagnostics: [],
    };
  }

  return {
    ok: false,
    diagnostics: [{
      code: "SCHEMA_INVALID",
      path: "$",
      message: "Expected an Anim8 1.0 scene.",
      suggestion: "Include version, objects, and timeline.",
    }],
  };
};

describe("@anim8/ai fixtures", () => {
  it("ships a fixed, unique benchmark case set", () => {
    expect(BENCHMARK_CASES.map(testCase => testCase.id)).toEqual(expectedFixtureIds);
    expect(new Set(BENCHMARK_CASES.map(testCase => testCase.id)).size).toBe(BENCHMARK_CASES.length);
    expect(BENCHMARK_CASES).toHaveLength(36);

    for (const testCase of BENCHMARK_CASES) {
      expect(testCase.prompt.length).toBeGreaterThan(30);
      expect(testCase.capabilityTags.length).toBeGreaterThan(0);
    }
  });

  it("exposes cases by stable id and agent-facing safety instructions", () => {
    expect(getBenchmarkCase("group-parenting")?.capabilityTags).toContain("groups");
    expect(getBenchmarkCase("missing")).toBeUndefined();
    expect(AGENT_SYSTEM_PROMPT).toContain("Return exactly one JSON object");
    expect(AGENT_SYSTEM_PROMPT).toContain("never use javascript:");
  });
});

describe("@anim8/ai metrics", () => {
  it("measures UTF-8 size and deterministic fallback token estimates", () => {
    expect(utf8Size("hello")).toBe(5);
    expect(utf8Size("é")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("12345")).toBe(2);
  });

  it("supports an injected exact/custom token counter without a tokenizer dependency", () => {
    const metrics = measureText("one two three", text => text.split(" ").length);
    expect(metrics).toEqual({
      characters: 13,
      utf8Bytes: 13,
      lines: 1,
      estimatedTokens: 4,
      countedTokens: 3,
    });

    expect(() => measureText("bad", () => -1)).toThrow(RangeError);
    expect(() => measureText("bad", () => 1.5)).toThrow(RangeError);
  });

  it("measures canonical JSON size and structure", () => {
    const metrics = measureJson({
      version: "1.0",
      objects: [{ id: "a" }],
      timeline: [],
    });

    expect(metrics.serializedUtf8Bytes).toBe(metrics.serializedCharacters);
    expect(metrics.objectKeys).toBe(4);
    expect(metrics.arrayItems).toBe(1);
    expect(metrics.maxDepth).toBe(4);
  });
});

describe("@anim8/ai scoring", () => {
  it("scores schema validation as a strict binary outcome with diagnostic counts", () => {
    const diagnostics = [
      { code: "INVALID_ID", path: "objects[0].id", message: "bad" },
      { code: "INVALID_ID", path: "objects[1].id", message: "bad" },
      { code: "UNKNOWN_OBJECT", path: "timeline[0].target", message: "missing" },
    ];

    expect(scoreSchemaValidation(true, { ok: false, diagnostics }, diagnostics)).toEqual({
      parseOk: true,
      schemaValid: false,
      score: 0,
      diagnosticCount: 3,
      diagnosticCodes: {
        INVALID_ID: 2,
        UNKNOWN_OBJECT: 1,
      },
    });
    expect(scoreSchemaValidation(true, { ok: true, diagnostics: [] }, [])).toEqual(
      expect.objectContaining({ schemaValid: true, score: 1 }),
    );
  });

  it("builds bounded repair instructions with stable diagnostic locations", () => {
    const instruction = buildRepairInstruction([{
      code: "UNKNOWN_OBJECT",
      path: "timeline[0].target",
      message: "Object 'x' does not exist.",
      suggestion: "Use 'a'.",
    }]);

    expect(instruction).toContain("[UNKNOWN_OBJECT] timeline[0].target");
    expect(instruction).toContain("Suggestion: Use 'a'.");
    expect(instruction).toContain("complete replacement JSON object");
  });
});

describe("@anim8/ai benchmark harness", () => {
  it("repairs strict-JSON parse failures through a provider-neutral callback", async () => {
    const requests: GenerationRequest[] = [];
    const result = await runBenchmarkCase(
      BENCHMARK_CASES[0]!,
      request => {
        requests.push(request);
        if (request.attempt === 1) {
          return {
            text: "```json\n{\"version\":\"1.0\"}\n```",
            usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
            model: "fake-model",
          };
        }
        return JSON.stringify({
          version: "1.0",
          scene: { width: 800, height: 450 },
          objects: [],
          timeline: [],
        });
      },
      sceneValidator,
      { maxAttempts: 2, tokenCounter: text => Math.ceil(text.length / 3) },
    );

    expect(result.success).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.parseError?.code).toBe("JSON_PARSE_ERROR");
    expect(result.attempts[0]?.metrics.providerUsage?.outputTokens).toBe(8);
    expect(result.attempts[1]?.metrics.json).toBeDefined();
    expect(result.attempts[1]?.metrics.output.countedTokens).toBeGreaterThan(0);

    expect(requests[1]?.repair?.diagnostics[0]?.code).toBe("JSON_PARSE_ERROR");
    expect(requests[1]?.repair?.previousOutput).toContain("```json");
  });

  it("feeds validator diagnostics into the next repair turn", async () => {
    const requests: GenerationRequest[] = [];
    const result = await runBenchmarkCase(
      BENCHMARK_CASES[4]!,
      request => {
        requests.push(request);
        if (request.attempt === 1) {
          return JSON.stringify({ version: "1.0", objects: [] });
        }
        return JSON.stringify({ version: "1.0", objects: [], timeline: [] });
      },
      sceneValidator,
      { maxAttempts: 2 },
    );

    expect(result.success).toBe(true);
    expect(requests[1]?.repair?.diagnostics).toEqual([
      expect.objectContaining({ code: "SCHEMA_INVALID", path: "$" }),
    ]);
    expect(requests[1]?.repair?.instruction).toContain("SCHEMA_INVALID");
  });

  it("does not retry a successful first attempt", async () => {
    let calls = 0;
    const result = await runBenchmarkCase(
      BENCHMARK_CASES[1]!,
      () => {
        calls += 1;
        return JSON.stringify({ version: "1.0", objects: [], timeline: [] });
      },
      sceneValidator,
      { maxAttempts: 3 },
    );

    expect(result.success).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("validates max attempts and provider usage", async () => {
    await expect(runBenchmarkCase(
      BENCHMARK_CASES[0]!,
      () => "{}",
      sceneValidator,
      { maxAttempts: 0 },
    )).rejects.toThrow(RangeError);

    await expect(runBenchmarkCase(
      BENCHMARK_CASES[0]!,
      () => ({ text: "{}", usage: { outputTokens: -1 } }),
      sceneValidator,
    )).rejects.toThrow(RangeError);
  });

  it("runs suites in fixture order and summarizes first-pass versus repaired success", async () => {
    const attempts = new Map<string, number>();
    const cases = [BENCHMARK_CASES[0]!, BENCHMARK_CASES[1]!];

    const result = await runBenchmarkSuite(
      cases,
      request => {
        const count = (attempts.get(request.caseId) ?? 0) + 1;
        attempts.set(request.caseId, count);

        if (request.caseId === cases[1]!.id && count === 1) return "{not json";
        return JSON.stringify({ version: "1.0", objects: [], timeline: [] });
      },
      sceneValidator,
      { maxAttempts: 2 },
    );

    expect(result.resultVersion).toBe(1);
    expect(result.cases.map(item => item.case.id)).toEqual(cases.map(item => item.id));
    expect(result.summary).toEqual({
      caseCount: 2,
      successfulCases: 2,
      failedCases: 0,
      firstPassValidCases: 1,
      repairedValidCases: 1,
      parseSuccessRate: 1,
      schemaValidRate: 1,
      firstPassValidRate: 0.5,
      averageAttemptsPerCase: 1.5,
    });
  });

  it("summarizes an empty result set without NaN metrics", () => {
    expect(summarizeBenchmark([])).toEqual({
      caseCount: 0,
      successfulCases: 0,
      failedCases: 0,
      firstPassValidCases: 0,
      repairedValidCases: 0,
      parseSuccessRate: 0,
      schemaValidRate: 0,
      firstPassValidRate: 0,
      averageAttemptsPerCase: 0,
    });
  });
});
