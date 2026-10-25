import {
  evaluate,
  worldVisible,
  type DrawableObject,
  type EvaluatedScene,
  type EvaluationContext,
  type ScalarValue,
  type SceneDocument,
} from "@anim8/core";

export interface AccessibleObjectSummary {
  id: string;
  type: DrawableObject["type"];
  label: string;
}

export interface AccessibleRelationshipSummary {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface AccessibleSummary {
  text: string;
  objects: AccessibleObjectSummary[];
  relationships: AccessibleRelationshipSummary[];
  step?: { id: string; label: string; time: number };
  state?: Record<string, ScalarValue>;
}

export interface DescribeFrameOptions {
  source?: SceneDocument;
  state?: Record<string, ScalarValue>;
  title?: string;
  description?: string;
  maxObjects?: number;
  includeRelationships?: boolean;
  includeState?: boolean;
}

export interface DescribeSceneOptions extends Omit<DescribeFrameOptions, "source"> {
  time?: number;
  context?: EvaluationContext;
}

function stringMetadata(object: DrawableObject, key: string): string | undefined {
  const value = object.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectLabel(object: DrawableObject): string {
  if (object.description?.trim()) return object.description.trim();

  switch (object.type) {
    case "rect":
    case "circle":
      if (object.text?.trim()) return object.text.trim();
      break;
    case "text":
      if (object.text.trim()) return object.text.trim();
      break;
    case "image":
      if (object.alt?.trim()) return object.alt.trim();
      break;
    case "connector":
      if (object.label?.trim()) return object.label.trim();
      break;
  }

  return stringMetadata(object, "label") ?? `${object.type} ${object.id}`;
}

function effectiveState(
  source: SceneDocument | undefined,
  override: Record<string, ScalarValue> | undefined,
): Record<string, ScalarValue> | undefined {
  const base = source?.state;
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}

function currentStep(source: SceneDocument | undefined, time: number) {
  if (!source?.markers?.length) return undefined;
  return [...source.markers]
    .filter(marker => marker.time <= time)
    .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))[0];
}

function scalarText(value: ScalarValue): string {
  if (value === null) return "null";
  return typeof value === "string" ? value : String(value);
}

export function describeFrame(
  frame: EvaluatedScene,
  options: DescribeFrameOptions = {},
): AccessibleSummary {
  const map = new Map(frame.objects.map(object => [object.id, object]));
  const visible = frame.objects.filter(object => worldVisible(object, map));
  const maxObjects = Math.max(0, Math.floor(options.maxObjects ?? 50));
  const drawable = visible.filter(object => object.type !== "connector");
  const objects = drawable.slice(0, maxObjects).map(object => ({
    id: object.id,
    type: object.type,
    label: objectLabel(object),
  }));

  const labelById = new Map(drawable.map(object => [object.id, objectLabel(object)]));
  const relationships = options.includeRelationships === false
    ? []
    : visible
        .filter((object): object is Extract<DrawableObject, { type: "connector" }> => object.type === "connector")
        .map(connector => ({
          id: connector.id,
          from: labelById.get(connector.from.objectId) ?? connector.from.objectId,
          to: labelById.get(connector.to.objectId) ?? connector.to.objectId,
          ...(connector.label?.trim() ? { label: connector.label.trim() } : {}),
        }));

  const step = currentStep(options.source, frame.time);
  const state = options.includeState === false ? undefined : effectiveState(options.source, options.state);
  const parts: string[] = [];

  if (options.title?.trim()) parts.push(options.title.trim() + ".");
  if (options.description?.trim()) parts.push(options.description.trim() + ".");
  if (step) parts.push(`Step: ${step.label}.`);

  if (objects.length) {
    parts.push("Visible objects: " + objects.map(object => object.label).join(", ") + ".");
  } else {
    parts.push("No visible drawable objects.");
  }

  if (drawable.length > objects.length) {
    parts.push(`${drawable.length - objects.length} additional visible objects omitted.`);
  }

  if (relationships.length) {
    parts.push(
      "Relationships: " +
      relationships.map(relationship =>
        `${relationship.from} to ${relationship.to}${relationship.label ? ` (${relationship.label})` : ""}`
      ).join("; ") +
      ".",
    );
  }

  if (state && Object.keys(state).length) {
    const stateText = Object.keys(state)
      .sort()
      .map(key => `${key}=${scalarText(state[key] ?? null)}`)
      .join(", ");
    parts.push("State: " + stateText + ".");
  }

  return {
    text: parts.join(" "),
    objects,
    relationships,
    ...(step ? { step: { ...step } } : {}),
    ...(state ? { state } : {}),
  };
}

export function describeScene(
  scene: SceneDocument,
  options: DescribeSceneOptions = {},
): AccessibleSummary {
  const time = options.time ?? 0;
  const context: EvaluationContext = {
    ...(options.context?.inputs ? { inputs: options.context.inputs } : {}),
    ...(options.context?.state ? { state: options.context.state } : {}),
  };
  const frame = evaluate(scene, time, context);
  return describeFrame(frame, {
    source: scene,
    ...(options.context?.state ? { state: options.context.state } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.maxObjects !== undefined ? { maxObjects: options.maxObjects } : {}),
    ...(options.includeRelationships !== undefined ? { includeRelationships: options.includeRelationships } : {}),
    ...(options.includeState !== undefined ? { includeState: options.includeState } : {}),
  });
}
