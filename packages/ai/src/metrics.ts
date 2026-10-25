import type { JsonMetrics, TextMetrics, TokenCounter } from "./types.js";

const encoder = new TextEncoder();

export function utf8Size(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * Provider-neutral fallback estimate. Exact tokenization varies by model, so
 * benchmark adapters should inject a TokenCounter or report provider usage when
 * exact counts matter.
 */
export function estimateTokens(text: string): number {
  const bytes = utf8Size(text);
  return bytes === 0 ? 0 : Math.ceil(bytes / 4);
}

export function measureText(text: string, tokenCounter?: TokenCounter): TextMetrics {
  let countedTokens: number | undefined;
  if (tokenCounter) {
    const count = tokenCounter(text);
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      throw new RangeError("Token counter must return a finite non-negative integer.");
    }
    countedTokens = count;
  }

  return {
    characters: text.length,
    utf8Bytes: utf8Size(text),
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    estimatedTokens: estimateTokens(text),
    ...(countedTokens !== undefined ? { countedTokens } : {}),
  };
}

interface StructureCounts {
  objectKeys: number;
  arrayItems: number;
  maxDepth: number;
}

function countStructure(value: unknown, depth: number, counts: StructureCounts): void {
  counts.maxDepth = Math.max(counts.maxDepth, depth);

  if (Array.isArray(value)) {
    counts.arrayItems += value.length;
    for (const item of value) countStructure(item, depth + 1, counts);
    return;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    counts.objectKeys += keys.length;
    for (const key of keys) countStructure(record[key], depth + 1, counts);
  }
}

/**
 * Measures canonical JSON.stringify output. Intended for JSON-compatible data
 * such as a candidate returned by JSON.parse.
 */
export function measureJson(value: unknown): JsonMetrics {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Value is not serializable as JSON.");
  }

  const counts: StructureCounts = { objectKeys: 0, arrayItems: 0, maxDepth: 0 };
  countStructure(value, 1, counts);

  return {
    serializedCharacters: serialized.length,
    serializedUtf8Bytes: utf8Size(serialized),
    objectKeys: counts.objectKeys,
    arrayItems: counts.arrayItems,
    maxDepth: counts.maxDepth,
  };
}
