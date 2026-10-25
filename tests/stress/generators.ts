export interface GeneratedScene {
  version: "1.0";
  scene: {
    width: number;
    height: number;
    theme: "clean";
    background: string;
    seed: number;
  };
  objects: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
}

export interface InvalidSceneCase {
  name: string;
  scene: GeneratedScene;
  expectedCode: string;
}

export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state / 0x1_0000_0000;
  }

  int(min: number, maxInclusive: number): number {
    if (maxInclusive < min) throw new RangeError("maxInclusive must be >= min");
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError("cannot pick from an empty array");
    return values[this.int(0, values.length - 1)]!;
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

const COLORS = ["#0f172a", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#d97706"] as const;
const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut", "spring"] as const;

function transform(rng: SeededRandom, x: number, y: number) {
  return {
    x,
    y,
    rotation: rng.int(-30, 30),
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };
}

function style(rng: SeededRandom) {
  return {
    fill: "#ffffff",
    stroke: rng.pick(COLORS),
    strokeWidth: rng.int(1, 4),
    color: "#111827",
    fontSize: rng.int(12, 22),
    radius: rng.int(0, 16),
  };
}

function group(id: string, children: string[], parentId: string | undefined, rng: SeededRandom, depth: number) {
  return {
    id,
    type: "group",
    children,
    ...(parentId ? { parentId } : {}),
    transform: transform(rng, 35 + depth * 20, 25 + depth * 15),
    style: style(rng),
    visible: true,
    z: depth,
  };
}

function rect(id: string, parentId: string, rng: SeededRandom, index: number) {
  return {
    id,
    type: "rect",
    parentId,
    width: rng.int(30, 140),
    height: rng.int(20, 90),
    text: `node-${index}`,
    transform: transform(rng, rng.int(-100, 180), rng.int(-80, 150)),
    style: style(rng),
    visible: true,
    z: 10 + index,
  };
}

function circle(id: string, parentId: string, rng: SeededRandom, index: number) {
  return {
    id,
    type: "circle",
    parentId,
    radius: rng.int(10, 50),
    text: `c${index}`,
    transform: transform(rng, rng.int(-100, 180), rng.int(-80, 150)),
    style: style(rng),
    visible: true,
    z: 10 + index,
  };
}

function textObject(id: string, parentId: string, rng: SeededRandom, index: number) {
  return {
    id,
    type: "text",
    parentId,
    text: `label-${index}`,
    transform: transform(rng, rng.int(-100, 180), rng.int(-80, 150)),
    style: style(rng),
    visible: true,
    z: 10 + index,
  };
}

function leafObject(id: string, parentId: string, rng: SeededRandom, index: number) {
  const kind = rng.pick(["rect", "circle", "text"] as const);
  if (kind === "circle") return circle(id, parentId, rng, index);
  if (kind === "text") return textObject(id, parentId, rng, index);
  return rect(id, parentId, rng, index);
}

function connector(id: string, from: string, to: string, rng: SeededRandom, z: number) {
  return {
    id,
    type: "connector",
    from: { objectId: from, anchor: rng.pick(["center", "left", "right", "top", "bottom"] as const) },
    to: { objectId: to, anchor: rng.pick(["center", "left", "right", "top", "bottom"] as const) },
    kind: rng.pick(["straight", "curve", "orthogonal"] as const),
    transform: {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    },
    style: {
      fill: "none",
      stroke: rng.pick(COLORS),
      strokeWidth: rng.int(1, 3),
      color: "#111827",
      fontSize: 16,
      radius: 0,
    },
    visible: true,
    z,
  };
}

function timeline(rng: SeededRandom, leafIds: readonly string[]): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  let cursor = 0;
  const count = rng.int(5, 12);

  for (let index = 0; index < count; index += 1) {
    const target = rng.pick(leafIds);
    const duration = rng.int(1, 160);
    const easing = rng.pick(EASINGS);
    const kind = rng.pick(["move", "rotate", "scale", "opacity", "fill", "stroke"] as const);
    const base = {
      id: `action_${index}`,
      type: kind,
      target,
      start: cursor,
      duration,
      easing,
    };

    switch (kind) {
      case "move":
        actions.push({
          ...base,
          to: { x: rng.int(-300, 600), y: rng.int(-250, 450) },
          ...(rng.bool(0.3)
            ? {
                path: rng.pick(["arc-up", "arc-down"] as const),
                arcHeight: rng.int(10, 120),
              }
            : {}),
        });
        break;
      case "rotate":
        actions.push({ ...base, to: rng.int(-360, 360) });
        break;
      case "scale":
        actions.push({
          ...base,
          to: {
            x: rng.int(25, 200) / 100,
            y: rng.int(25, 200) / 100,
          },
        });
        break;
      case "opacity":
        actions.push({ ...base, to: rng.int(0, 100) / 100 });
        break;
      case "fill":
      case "stroke":
        actions.push({ ...base, to: rng.pick(COLORS) });
        break;
    }

    // Global sequencing deliberately prevents property conflicts while still
    // exercising many targets/action kinds.
    cursor += duration + rng.int(0, 20);
  }

  return actions;
}

export function generateValidScene(seed: number): GeneratedScene {
  const rng = new SeededRandom(seed);
  const groupIds = ["group_root", "group_mid", "group_inner"] as const;
  const leafIds = Array.from({ length: rng.int(6, 10) }, (_, index) => `leaf_${index}`);

  const rootChildren = [groupIds[1], ...leafIds.filter((_, index) => index % 3 === 0)];
  const midChildren = [groupIds[2], ...leafIds.filter((_, index) => index % 3 === 1)];
  const innerChildren = leafIds.filter((_, index) => index % 3 === 2);

  const objects: Array<Record<string, unknown>> = [
    group(groupIds[0], rootChildren, undefined, rng, 0),
    group(groupIds[1], midChildren, groupIds[0], rng, 1),
    group(groupIds[2], innerChildren, groupIds[1], rng, 2),
  ];

  for (let index = 0; index < leafIds.length; index += 1) {
    const parentId = index % 3 === 0 ? groupIds[0] : index % 3 === 1 ? groupIds[1] : groupIds[2];
    objects.push(leafObject(leafIds[index]!, parentId, rng, index));
  }

  if (leafIds.length >= 4) {
    objects.push(
      connector("edge_0", leafIds[0]!, leafIds[leafIds.length - 1]!, rng, 5),
      connector("edge_1", leafIds[1]!, leafIds[leafIds.length - 2]!, rng, 6),
    );
  }

  return {
    version: "1.0",
    scene: {
      width: rng.int(320, 1200),
      height: rng.int(240, 720),
      theme: "clean",
      background: "#f8fafc",
      seed,
    },
    objects,
    timeline: timeline(rng, leafIds),
  };
}

export function cloneScene<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findFirstByType(scene: GeneratedScene, type: string): Record<string, unknown> {
  const object = scene.objects.find(candidate => candidate.type === type);
  if (!object) throw new Error(`generated scene has no ${type}`);
  return object;
}

function firstLeaf(scene: GeneratedScene): Record<string, unknown> {
  const object = scene.objects.find(candidate => typeof candidate.id === "string" && String(candidate.id).startsWith("leaf_"));
  if (!object) throw new Error("generated scene has no leaf");
  return object;
}

export function generateInvalidScenes(seed: number): InvalidSceneCase[] {
  const duplicate = cloneScene(generateValidScene(seed));
  const duplicateLeaf = duplicate.objects.find(candidate => candidate.id === "leaf_1");
  if (!duplicateLeaf) throw new Error("generated scene has no leaf_1");
  duplicateLeaf.id = "leaf_0";

  const unknownParent = cloneScene(generateValidScene(seed + 1));
  firstLeaf(unknownParent).parentId = "missing_parent";

  const unknownChild = cloneScene(generateValidScene(seed + 2));
  const root = findFirstByType(unknownChild, "group");
  const children = root.children;
  if (!Array.isArray(children)) throw new Error("generated group has no children");
  children.push("missing_child");

  const badConnector = cloneScene(generateValidScene(seed + 3));
  const edge = findFirstByType(badConnector, "connector");
  edge.to = { objectId: "missing_endpoint", anchor: "left" };

  const badTimeline = cloneScene(generateValidScene(seed + 4));
  if (!badTimeline.timeline[0]) throw new Error("generated scene has no timeline");
  badTimeline.timeline[0].target = "missing_target";

  return [
    { name: "duplicate object id", scene: duplicate, expectedCode: "DUPLICATE_ID" },
    { name: "unknown parent reference", scene: unknownParent, expectedCode: "UNKNOWN_PARENT" },
    { name: "unknown group child", scene: unknownChild, expectedCode: "UNKNOWN_GROUP_CHILD" },
    { name: "unknown connector endpoint", scene: badConnector, expectedCode: "UNKNOWN_CONNECTOR_OBJECT" },
    { name: "unknown timeline target", scene: badTimeline, expectedCode: "UNKNOWN_OBJECT" },
  ];
}
