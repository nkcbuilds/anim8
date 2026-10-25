import {
  defaultStyle,
  defaultTransform,
  evaluate,
  type Action,
  type DrawableObject,
  type Marker,
  type SceneDocument,
  type ThemeName,
} from "@anim8/core";

export interface DslDiagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface DslCompileResult {
  ok: boolean;
  scene?: SceneDocument;
  diagnostics: DslDiagnostic[];
}

interface Token {
  value: string;
  column: number;
  quoted: boolean;
}

interface ParseState {
  width: number;
  height: number;
  theme: ThemeName;
  background: string | undefined;
  seed: number | undefined;
  sawScene: boolean;
  objects: DrawableObject[];
  objectIds: Set<string>;
  timeline: Action[];
  markers: Marker[];
  cursor: number;
  actionCounter: number;
  connectorCounter: number;
  markerCounter: number;
  diagnostics: DslDiagnostic[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function diagnostic(
  state: ParseState,
  code: string,
  message: string,
  line: number,
  column: number,
): void {
  state.diagnostics.push({ code, message, line, column });
}

function tokenize(lineText: string, line: number): { tokens: Token[]; diagnostic?: DslDiagnostic } {
  const tokens: Token[] = [];
  let index = 0;

  while (index < lineText.length) {
    while (index < lineText.length && /\s/.test(lineText[index]!)) index += 1;
    if (index >= lineText.length) break;

    const column = index + 1;
    if (lineText.startsWith("->", index)) {
      tokens.push({ value: "->", column, quoted: false });
      index += 2;
      continue;
    }

    if (lineText[index] === '"') {
      index += 1;
      let value = "";
      let closed = false;

      while (index < lineText.length) {
        const char = lineText[index]!;
        if (char === '"') {
          closed = true;
          index += 1;
          break;
        }
        if (char === "\\") {
          const next = lineText[index + 1];
          if (next === undefined) break;
          switch (next) {
            case '"': value += '"'; break;
            case "\\": value += "\\"; break;
            case "n": value += "\n"; break;
            case "r": value += "\r"; break;
            case "t": value += "\t"; break;
            default:
              return {
                tokens,
                diagnostic: {
                  code: "INVALID_ESCAPE",
                  message: `Unsupported escape sequence '\\${next}'.`,
                  line,
                  column: index + 1,
                },
              };
          }
          index += 2;
          continue;
        }
        value += char;
        index += 1;
      }

      if (!closed) {
        return {
          tokens,
          diagnostic: {
            code: "UNTERMINATED_STRING",
            message: "Quoted strings must end with a double quote.",
            line,
            column,
          },
        };
      }

      tokens.push({ value, column, quoted: true });
      continue;
    }

    const start = index;
    while (
      index < lineText.length
      && !/\s/.test(lineText[index]!)
      && !lineText.startsWith("->", index)
    ) {
      index += 1;
    }
    tokens.push({ value: lineText.slice(start, index), column, quoted: false });
  }

  return { tokens };
}

function tokenAt(tokens: Token[], index: number): Token | undefined {
  return tokens[index];
}

function requireToken(
  state: ParseState,
  tokens: Token[],
  index: number,
  line: number,
  expected: string,
): Token | undefined {
  const token = tokenAt(tokens, index);
  if (token) return token;

  const column = tokens.length
    ? tokens[tokens.length - 1]!.column + tokens[tokens.length - 1]!.value.length
    : 1;
  diagnostic(state, "EXPECTED_TOKEN", `Expected ${expected}.`, line, column);
  return undefined;
}

function requireLiteral(
  state: ParseState,
  tokens: Token[],
  index: number,
  line: number,
  value: string,
): boolean {
  const token = requireToken(state, tokens, index, line, `'${value}'`);
  if (!token) return false;
  if (token.value === value && !token.quoted) return true;

  diagnostic(state, "EXPECTED_TOKEN", `Expected '${value}'.`, line, token.column);
  return false;
}

function parseNumber(
  state: ParseState,
  token: Token | undefined,
  line: number,
  label: string,
): number | undefined {
  if (!token) return undefined;
  if (token.quoted || !NUMBER.test(token.value)) {
    diagnostic(state, "INVALID_NUMBER", `${label} must be a finite number.`, line, token.column);
    return undefined;
  }

  const value = Number(token.value);
  if (!Number.isFinite(value)) {
    diagnostic(state, "INVALID_NUMBER", `${label} must be a finite number.`, line, token.column);
    return undefined;
  }
  return value;
}

function parsePositiveNumber(
  state: ParseState,
  token: Token | undefined,
  line: number,
  label: string,
): number | undefined {
  const value = parseNumber(state, token, line, label);
  if (value === undefined) return undefined;
  if (value <= 0) {
    diagnostic(state, "INVALID_SIZE", `${label} must be greater than 0.`, line, token!.column);
    return undefined;
  }
  return value;
}

function parseDuration(
  state: ParseState,
  token: Token | undefined,
  line: number,
): number | undefined {
  const value = parseNumber(state, token, line, "duration");
  if (value === undefined) return undefined;
  if (value < 0) {
    diagnostic(state, "INVALID_DURATION", "duration must be greater than or equal to 0.", line, token!.column);
    return undefined;
  }
  return value;
}

function requireIdentifier(
  state: ParseState,
  token: Token | undefined,
  line: number,
  label: string,
): string | undefined {
  if (!token) return undefined;
  if (token.quoted || !IDENTIFIER.test(token.value)) {
    diagnostic(
      state,
      "INVALID_IDENTIFIER",
      `${label} must match [A-Za-z_][A-Za-z0-9_-]*.`,
      line,
      token.column,
    );
    return undefined;
  }
  return token.value;
}

function requireQuoted(
  state: ParseState,
  token: Token | undefined,
  line: number,
  label: string,
): string | undefined {
  if (!token) return undefined;
  if (!token.quoted) {
    diagnostic(state, "EXPECTED_STRING", `${label} must be a quoted string.`, line, token.column);
    return undefined;
  }
  return token.value;
}

function rejectExtra(
  state: ParseState,
  tokens: Token[],
  index: number,
  line: number,
): boolean {
  const token = tokenAt(tokens, index);
  if (!token) return false;
  diagnostic(state, "UNEXPECTED_TOKEN", `Unexpected token '${token.value}'.`, line, token.column);
  return true;
}

function addObject(state: ParseState, object: DrawableObject, line: number, column: number): boolean {
  if (state.objectIds.has(object.id)) {
    diagnostic(state, "DUPLICATE_ID", `Object id '${object.id}' is already defined.`, line, column);
    return false;
  }
  state.objects.push(object);
  state.objectIds.add(object.id);
  return true;
}

function requireKnownObject(
  state: ParseState,
  id: string,
  line: number,
  column: number,
): boolean {
  if (state.objectIds.has(id)) return true;
  diagnostic(
    state,
    "UNKNOWN_OBJECT",
    `Object '${id}' is not defined yet. Declare objects before referencing them.`,
    line,
    column,
  );
  return false;
}

function nextConnectorId(state: ParseState): string {
  while (true) {
    state.connectorCounter += 1;
    const id = `connector_${state.connectorCounter}`;
    if (!state.objectIds.has(id)) return id;
  }
}

function nextActionId(state: ParseState, type: Action["type"]): string {
  state.actionCounter += 1;
  return `${type}_${state.actionCounter}`;
}

function nextMarkerId(state: ParseState): string {
  state.markerCounter += 1;
  return `step_${state.markerCounter}`;
}

function currentScene(state: ParseState): SceneDocument {
  return {
    version: "1.0",
    scene: {
      width: state.width,
      height: state.height,
      theme: state.theme,
      ...(state.background !== undefined ? { background: state.background } : {}),
      ...(state.seed !== undefined ? { seed: state.seed } : {}),
    },
    objects: state.objects,
    timeline: state.timeline,
    ...(state.markers.length ? { markers: state.markers } : {}),
  };
}

function positionAt(state: ParseState, id: string): { x: number; y: number } {
  const evaluated = evaluate(currentScene(state), state.cursor);
  const object = evaluated.objects.find((candidate) => candidate.id === id);
  if (!object) return { x: 0, y: 0 };
  return { x: object.transform.x, y: object.transform.y };
}

function parseScene(state: ParseState, tokens: Token[], line: number): void {
  if (state.sawScene) {
    diagnostic(state, "DUPLICATE_SCENE", "Only one scene command is allowed.", line, tokens[0]!.column);
    return;
  }

  const widthToken = requireToken(state, tokens, 1, line, "scene width");
  const heightToken = requireToken(state, tokens, 2, line, "scene height");
  const width = parsePositiveNumber(state, widthToken, line, "scene width");
  const height = parsePositiveNumber(state, heightToken, line, "scene height");
  if (width === undefined || height === undefined) return;

  let background: string | undefined;
  let seed: number | undefined;
  let index = 3;

  while (index < tokens.length) {
    const option = tokens[index]!;
    if (option.quoted) {
      diagnostic(state, "UNKNOWN_OPTION", `Unknown scene option '${option.value}'.`, line, option.column);
      return;
    }

    if (option.value === "background") {
      const value = requireToken(state, tokens, index + 1, line, "background value");
      if (!value) return;
      background = value.value;
      index += 2;
      continue;
    }

    if (option.value === "seed") {
      const valueToken = requireToken(state, tokens, index + 1, line, "seed value");
      const value = parseNumber(state, valueToken, line, "seed");
      if (value === undefined) return;
      seed = value;
      index += 2;
      continue;
    }

    diagnostic(state, "UNKNOWN_OPTION", `Unknown scene option '${option.value}'.`, line, option.column);
    return;
  }

  state.width = width;
  state.height = height;
  state.background = background;
  state.seed = seed;
  state.sawScene = true;
}

function parseTheme(state: ParseState, tokens: Token[], line: number): void {
  const token = requireToken(state, tokens, 1, line, "theme name");
  if (!token) return;
  if (token.quoted || (token.value !== "clean" && token.value !== "sketch")) {
    diagnostic(state, "INVALID_THEME", "Theme must be 'clean' or 'sketch'.", line, token.column);
    return;
  }
  if (rejectExtra(state, tokens, 2, line)) return;
  state.theme = token.value;
}

function parseBox(state: ParseState, tokens: Token[], line: number): void {
  const idToken = requireToken(state, tokens, 1, line, "box id");
  const textToken = requireToken(state, tokens, 2, line, "box label");
  if (!idToken || !textToken) return;
  const id = requireIdentifier(state, idToken, line, "box id");
  const text = requireQuoted(state, textToken, line, "box label");
  if (!id || text === undefined) return;
  if (!requireLiteral(state, tokens, 3, line, "at")) return;

  const xToken = requireToken(state, tokens, 4, line, "x");
  const yToken = requireToken(state, tokens, 5, line, "y");
  const x = parseNumber(state, xToken, line, "x");
  const y = parseNumber(state, yToken, line, "y");
  if (x === undefined || y === undefined) return;

  let width = 100;
  let height = 60;
  let fill: string | undefined;
  let stroke: string | undefined;
  let index = 6;

  while (index < tokens.length) {
    const option = tokens[index]!;
    if (option.quoted) {
      diagnostic(state, "UNKNOWN_OPTION", `Unknown box option '${option.value}'.`, line, option.column);
      return;
    }

    if (option.value === "size") {
      const widthToken = requireToken(state, tokens, index + 1, line, "box width");
      const heightToken = requireToken(state, tokens, index + 2, line, "box height");
      const parsedWidth = parsePositiveNumber(state, widthToken, line, "box width");
      const parsedHeight = parsePositiveNumber(state, heightToken, line, "box height");
      if (parsedWidth === undefined || parsedHeight === undefined) return;
      width = parsedWidth;
      height = parsedHeight;
      index += 3;
      continue;
    }

    if (option.value === "fill" || option.value === "stroke") {
      const value = requireToken(state, tokens, index + 1, line, `${option.value} value`);
      if (!value) return;
      if (option.value === "fill") fill = value.value;
      else stroke = value.value;
      index += 2;
      continue;
    }

    diagnostic(state, "UNKNOWN_OPTION", `Unknown box option '${option.value}'.`, line, option.column);
    return;
  }

  const style = {
    ...defaultStyle(),
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };

  addObject(
    state,
    {
      id,
      type: "rect",
      width,
      height,
      text,
      transform: { ...defaultTransform(), x, y },
      style,
      visible: true,
      z: state.objects.length,
    },
    line,
    idToken.column,
  );
}

function parseCircle(state: ParseState, tokens: Token[], line: number): void {
  const idToken = requireToken(state, tokens, 1, line, "circle id");
  const textToken = requireToken(state, tokens, 2, line, "circle label");
  if (!idToken || !textToken) return;
  const id = requireIdentifier(state, idToken, line, "circle id");
  const text = requireQuoted(state, textToken, line, "circle label");
  if (!id || text === undefined) return;
  if (!requireLiteral(state, tokens, 3, line, "at")) return;

  const xToken = requireToken(state, tokens, 4, line, "x");
  const yToken = requireToken(state, tokens, 5, line, "y");
  const x = parseNumber(state, xToken, line, "x");
  const y = parseNumber(state, yToken, line, "y");
  if (x === undefined || y === undefined) return;

  let radius = 30;
  let fill: string | undefined;
  let stroke: string | undefined;
  let index = 6;

  while (index < tokens.length) {
    const option = tokens[index]!;
    if (option.quoted) {
      diagnostic(state, "UNKNOWN_OPTION", `Unknown circle option '${option.value}'.`, line, option.column);
      return;
    }

    if (option.value === "radius") {
      const radiusToken = requireToken(state, tokens, index + 1, line, "circle radius");
      const parsedRadius = parsePositiveNumber(state, radiusToken, line, "circle radius");
      if (parsedRadius === undefined) return;
      radius = parsedRadius;
      index += 2;
      continue;
    }

    if (option.value === "fill" || option.value === "stroke") {
      const value = requireToken(state, tokens, index + 1, line, `${option.value} value`);
      if (!value) return;
      if (option.value === "fill") fill = value.value;
      else stroke = value.value;
      index += 2;
      continue;
    }

    diagnostic(state, "UNKNOWN_OPTION", `Unknown circle option '${option.value}'.`, line, option.column);
    return;
  }

  const style = {
    ...defaultStyle(),
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };

  addObject(
    state,
    {
      id,
      type: "circle",
      radius,
      text,
      transform: { ...defaultTransform(), x, y },
      style,
      visible: true,
      z: state.objects.length,
    },
    line,
    idToken.column,
  );
}

function parseConnect(state: ParseState, tokens: Token[], line: number): void {
  const fromToken = requireToken(state, tokens, 1, line, "source object id");
  if (!requireLiteral(state, tokens, 2, line, "->")) return;
  const toToken = requireToken(state, tokens, 3, line, "target object id");
  if (!fromToken || !toToken) return;

  const from = requireIdentifier(state, fromToken, line, "source object id");
  const to = requireIdentifier(state, toToken, line, "target object id");
  if (!from || !to) return;
  if (!requireKnownObject(state, from, line, fromToken.column)) return;
  if (!requireKnownObject(state, to, line, toToken.column)) return;

  let kind: "straight" | "curve" | "orthogonal" | "routed" = "straight";
  let label: string | undefined;
  let index = 4;

  while (index < tokens.length) {
    const option = tokens[index]!;
    if (option.quoted) {
      diagnostic(state, "UNKNOWN_OPTION", `Unknown connect option '${option.value}'.`, line, option.column);
      return;
    }

    if (option.value === "kind") {
      const kindToken = requireToken(state, tokens, index + 1, line, "connector kind");
      if (!kindToken) return;
      if (
        kindToken.quoted
        || (kindToken.value !== "straight" && kindToken.value !== "curve" && kindToken.value !== "orthogonal" && kindToken.value !== "routed")
      ) {
        diagnostic(
          state,
          "INVALID_CONNECTOR_KIND",
          "Connector kind must be 'straight', 'curve', 'orthogonal', or 'routed'.",
          line,
          kindToken.column,
        );
        return;
      }
      kind = kindToken.value;
      index += 2;
      continue;
    }

    if (option.value === "label") {
      const labelToken = requireToken(state, tokens, index + 1, line, "connector label");
      const parsedLabel = requireQuoted(state, labelToken, line, "connector label");
      if (parsedLabel === undefined) return;
      label = parsedLabel;
      index += 2;
      continue;
    }

    diagnostic(state, "UNKNOWN_OPTION", `Unknown connect option '${option.value}'.`, line, option.column);
    return;
  }

  const id = nextConnectorId(state);
  addObject(
    state,
    {
      id,
      type: "connector",
      from: { objectId: from },
      to: { objectId: to },
      kind,
      ...(label !== undefined ? { label } : {}),
      transform: defaultTransform(),
      style: { ...defaultStyle(), fill: "none" },
      visible: true,
      z: state.objects.length,
    },
    line,
    tokens[0]!.column,
  );
}

function parseStep(state: ParseState, tokens: Token[], line: number): void {
  const labelToken = requireToken(state, tokens, 1, line, "step label");
  const label = requireQuoted(state, labelToken, line, "step label");
  if (label === undefined) return;
  if (rejectExtra(state, tokens, 2, line)) return;

  state.markers.push({
    id: nextMarkerId(state),
    label,
    time: state.cursor,
  });
}

function parseMove(state: ParseState, tokens: Token[], line: number): void {
  const idToken = requireToken(state, tokens, 1, line, "object id");
  if (!idToken) return;
  const id = requireIdentifier(state, idToken, line, "object id");
  if (!id) return;
  if (!requireKnownObject(state, id, line, idToken.column)) return;
  if (!requireLiteral(state, tokens, 2, line, "to")) return;

  const xToken = requireToken(state, tokens, 3, line, "x");
  const yToken = requireToken(state, tokens, 4, line, "y");
  const x = parseNumber(state, xToken, line, "x");
  const y = parseNumber(state, yToken, line, "y");
  if (x === undefined || y === undefined) return;

  let duration = 600;
  let index = 5;
  if (index < tokens.length) {
    if (!requireLiteral(state, tokens, index, line, "duration")) return;
    const durationToken = requireToken(state, tokens, index + 1, line, "duration");
    const parsedDuration = parseDuration(state, durationToken, line);
    if (parsedDuration === undefined) return;
    duration = parsedDuration;
    index += 2;
  }
  if (rejectExtra(state, tokens, index, line)) return;

  state.timeline.push({
    id: nextActionId(state, "move"),
    type: "move",
    target: id,
    start: state.cursor,
    duration,
    easing: "easeInOut",
    to: { x, y },
  });
  state.cursor += duration;
}

function parseSwap(state: ParseState, tokens: Token[], line: number): void {
  const aToken = requireToken(state, tokens, 1, line, "first object id");
  const bToken = requireToken(state, tokens, 2, line, "second object id");
  if (!aToken || !bToken) return;

  const a = requireIdentifier(state, aToken, line, "first object id");
  const b = requireIdentifier(state, bToken, line, "second object id");
  if (!a || !b) return;
  if (!requireKnownObject(state, a, line, aToken.column)) return;
  if (!requireKnownObject(state, b, line, bToken.column)) return;
  if (a === b) {
    diagnostic(state, "INVALID_SWAP", "swap requires two different object ids.", line, bToken.column);
    return;
  }

  let duration = 700;
  let index = 3;
  if (index < tokens.length) {
    if (!requireLiteral(state, tokens, index, line, "duration")) return;
    const durationToken = requireToken(state, tokens, index + 1, line, "duration");
    const parsedDuration = parseDuration(state, durationToken, line);
    if (parsedDuration === undefined) return;
    duration = parsedDuration;
    index += 2;
  }
  if (rejectExtra(state, tokens, index, line)) return;

  const aPosition = positionAt(state, a);
  const bPosition = positionAt(state, b);
  const start = state.cursor;

  state.timeline.push(
    {
      id: nextActionId(state, "move"),
      type: "move",
      target: a,
      start,
      duration,
      easing: "easeInOut",
      path: "arc-up",
      to: bPosition,
    },
    {
      id: nextActionId(state, "move"),
      type: "move",
      target: b,
      start,
      duration,
      easing: "easeInOut",
      path: "arc-down",
      to: aPosition,
    },
  );
  state.cursor += duration;
}

function parseHighlight(state: ParseState, tokens: Token[], line: number): void {
  const idToken = requireToken(state, tokens, 1, line, "object id");
  if (!idToken) return;
  const id = requireIdentifier(state, idToken, line, "object id");
  if (!id) return;
  if (!requireKnownObject(state, id, line, idToken.column)) return;

  let color = "#fef08a";
  let duration = 300;
  let index = 2;

  while (index < tokens.length) {
    const option = tokens[index]!;
    if (option.quoted) {
      diagnostic(state, "UNKNOWN_OPTION", `Unknown highlight option '${option.value}'.`, line, option.column);
      return;
    }

    if (option.value === "color") {
      const value = requireToken(state, tokens, index + 1, line, "highlight color");
      if (!value) return;
      color = value.value;
      index += 2;
      continue;
    }

    if (option.value === "duration") {
      const durationToken = requireToken(state, tokens, index + 1, line, "duration");
      const parsedDuration = parseDuration(state, durationToken, line);
      if (parsedDuration === undefined) return;
      duration = parsedDuration;
      index += 2;
      continue;
    }

    diagnostic(state, "UNKNOWN_OPTION", `Unknown highlight option '${option.value}'.`, line, option.column);
    return;
  }

  state.timeline.push({
    id: nextActionId(state, "fill"),
    type: "fill",
    target: id,
    start: state.cursor,
    duration,
    easing: "easeInOut",
    to: color,
  });
  state.cursor += duration;
}

function parseCommand(state: ParseState, tokens: Token[], line: number): void {
  const command = tokens[0]!;
  if (command.quoted) {
    diagnostic(state, "UNKNOWN_COMMAND", "Commands cannot be quoted.", line, command.column);
    return;
  }

  switch (command.value) {
    case "scene": parseScene(state, tokens, line); return;
    case "theme": parseTheme(state, tokens, line); return;
    case "box": parseBox(state, tokens, line); return;
    case "circle": parseCircle(state, tokens, line); return;
    case "connect": parseConnect(state, tokens, line); return;
    case "step": parseStep(state, tokens, line); return;
    case "move": parseMove(state, tokens, line); return;
    case "swap": parseSwap(state, tokens, line); return;
    case "highlight": parseHighlight(state, tokens, line); return;
    default:
      diagnostic(
        state,
        "UNKNOWN_COMMAND",
        `Unknown command '${command.value}'. Expected scene, theme, box, circle, connect, step, move, swap, or highlight.`,
        line,
        command.column,
      );
  }
}

export function compile(source: string): DslCompileResult {
  const state: ParseState = {
    width: 800,
    height: 450,
    theme: "clean",
    background: undefined,
    seed: undefined,
    sawScene: false,
    objects: [],
    objectIds: new Set<string>(),
    timeline: [],
    markers: [],
    cursor: 0,
    actionCounter: 0,
    connectorCounter: 0,
    markerCounter: 0,
    diagnostics: [],
  };

  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index]!;
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const result = tokenize(lineText, index + 1);
    if (result.diagnostic) {
      state.diagnostics.push(result.diagnostic);
      continue;
    }
    if (result.tokens.length === 0) continue;
    parseCommand(state, result.tokens, index + 1);
  }

  if (!state.sawScene) {
    state.diagnostics.push({
      code: "SCENE_REQUIRED",
      message: "A scene <width> <height> command is required.",
      line: 1,
      column: 1,
    });
  }

  if (state.diagnostics.length > 0) {
    return { ok: false, diagnostics: state.diagnostics };
  }

  return {
    ok: true,
    scene: currentScene(state),
    diagnostics: [],
  };
}

export const compileDsl = compile;
