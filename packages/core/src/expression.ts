import type { EvaluationContext, Expression, ScalarValue } from "./types.js";

export interface ExpressionEnvironment extends EvaluationContext {
  time: number;
  progress: number;
}

export interface ExpressionLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxStringLength?: number;
}

export type ExpressionResult =
  | { ok: true; value: ScalarValue }
  | { ok: false; code: string; message: string };

const number = (value: ScalarValue): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function readPath(path: string, env: ExpressionEnvironment): ScalarValue | undefined {
  if (path === "time") return env.time;
  if (path === "progress") return env.progress;
  const match = /^(inputs|state)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path);
  if (!match) return undefined;
  const [, root, key] = match;
  return root === "inputs" ? env.inputs?.[key!] : env.state?.[key!];
}

export function evaluateExpression(
  expression: Expression,
  env: ExpressionEnvironment,
  limits: ExpressionLimits = {},
): ExpressionResult {
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 256;
  const maxStringLength = limits.maxStringLength ?? 32768;
  let nodes = 0;

  const visit = (expr: Expression, depth: number): ExpressionResult => {
    nodes += 1;
    if (nodes > maxNodes) return { ok: false, code: "EXPR_NODE_LIMIT", message: `Expression exceeds ${maxNodes} nodes.` };
    if (depth > maxDepth) return { ok: false, code: "EXPR_DEPTH_LIMIT", message: `Expression exceeds depth ${maxDepth}.` };

    if (expr.kind === "literal") {
      if (typeof expr.value === "string" && expr.value.length > maxStringLength) {
        return { ok: false, code: "EXPR_STRING_LIMIT", message: `Expression string exceeds ${maxStringLength} characters.` };
      }
      return { ok: true, value: expr.value };
    }

    if (expr.kind === "get") {
      const value = readPath(expr.path, env);
      return value === undefined
        ? { ok: false, code: "EXPR_UNKNOWN_PATH", message: `Unknown expression path '${expr.path}'.` }
        : { ok: true, value };
    }

    const values: ScalarValue[] = [];
    for (const arg of expr.args) {
      const result = visit(arg, depth + 1);
      if (!result.ok) return result;
      values.push(result.value);
    }

    const nums = (): number[] | null => {
      const out = values.map(number);
      return out.some(value => value === null) ? null : out as number[];
    };
    const n = nums();

    switch (expr.op) {
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "min":
      case "max":
      case "clamp":
      case "lerp": {
        if (!n) return { ok: false, code: "EXPR_TYPE", message: `${expr.op} expects numeric arguments.` };
        let value: number;
        if (expr.op === "add") value = n.reduce((a,b)=>a+b,0);
        else if (expr.op === "sub") value = n.length === 1 ? -n[0]! : n.slice(1).reduce((a,b)=>a-b,n[0]!);
        else if (expr.op === "mul") value = n.reduce((a,b)=>a*b,1);
        else if (expr.op === "div") {
          if (n.length !== 2 || n[1] === 0) return { ok: false, code: "EXPR_DIV_ZERO", message: "div expects two numbers and a non-zero divisor." };
          value = n[0]! / n[1]!;
        } else if (expr.op === "min") value = Math.min(...n);
        else if (expr.op === "max") value = Math.max(...n);
        else if (expr.op === "clamp") {
          if (n.length !== 3) return { ok: false, code: "EXPR_ARITY", message: "clamp expects value, min, max." };
          value = Math.max(n[1]!, Math.min(n[2]!, n[0]!));
        } else {
          if (n.length !== 3) return { ok: false, code: "EXPR_ARITY", message: "lerp expects from, to, t." };
          value = n[0]! + (n[1]! - n[0]!) * n[2]!;
        }
        return Number.isFinite(value) ? { ok: true, value } : { ok: false, code: "EXPR_NON_FINITE", message: "Expression produced a non-finite number." };
      }
      case "eq":
        return values.length === 2 ? { ok: true, value: values[0] === values[1] } : { ok: false, code: "EXPR_ARITY", message: "eq expects two arguments." };
      case "lt":
      case "gt": {
        if (!n || n.length !== 2) return { ok: false, code: "EXPR_TYPE", message: `${expr.op} expects two numbers.` };
        return { ok: true, value: expr.op === "lt" ? n[0]! < n[1]! : n[0]! > n[1]! };
      }
      case "and":
      case "or": {
        if (!values.every(v => typeof v === "boolean")) return { ok: false, code: "EXPR_TYPE", message: `${expr.op} expects booleans.` };
        return { ok: true, value: expr.op === "and" ? values.every(Boolean) : values.some(Boolean) };
      }
      case "not":
        return values.length === 1 && typeof values[0] === "boolean"
          ? { ok: true, value: !values[0] }
          : { ok: false, code: "EXPR_TYPE", message: "not expects one boolean." };
    }
  };

  return visit(expression, 0);
}
