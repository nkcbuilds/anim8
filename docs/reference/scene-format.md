# Scene Format 1.0

Anim8 scene documents are JSON-compatible, versioned data.

## Top level

```ts
interface SceneDocument {
  version: "1.0";
  scene: {
    width: number;
    height: number;
    theme?: "clean" | "sketch";
    background?: string;
    seed?: number;
  };
  objects: DrawableObject[];
  timeline: Action[];
  state?: Record<string, string | number | boolean | null>;
  bindings?: Binding[];
  markers?: Marker[];
}
```

Every object has a stable `id`, transform, style, visibility and z-order. Parent relationships are represented with `parentId`.

## Supported v1 generic objects

- `rect`
- `circle`
- `ellipse`
- `polygon`
- `polyline`
- `text`
- `line`
- `path`
- `group`
- `connector`
- `image`

Higher-level technical shapes are composed from these generic primitives rather than creating a second animation engine.

### Draw progress

`path`, `polygon`, and `polyline` may carry normalized `drawProgress` in the inclusive range `0..1`.

The SVG renderers map this semantic property to normalized stroke-dash attributes. They do not ask the DOM to measure path length, preserving headless/deterministic behavior.

## Coordinates

Object geometry is local. `transform.x/y` position the object's local origin in its parent coordinate space.

Transforms are composed parent-to-child. Renderer output derives world matrices from the scene graph.

## Connectors

A connector references two object IDs and optional named anchors:

```json
{
  "id": "edge",
  "type": "connector",
  "from": { "objectId": "client", "anchor": "right" },
  "to": { "objectId": "server", "anchor": "left" },
  "kind": "straight"
}
```

Supported connector kinds are `straight`, `curve`, and `orthogonal`. Endpoints are recomputed from the evaluated world-space anchors, so connectors remain attached during movement and parent/group transforms.

## Declarative state and bindings

Portable scenes may define scalar state and constrained expression bindings. Safe expression paths are limited to `time`, `progress`, `inputs.<name>`, and `state.<name>`.

Bindings cannot execute JavaScript or access browser globals.

## Security

Unknown executable content is not part of the scene format. Do not place JavaScript, event handlers, raw HTML, or arbitrary SVG markup in generated scene documents.

The compiler also enforces resource limits, safe identifiers/references, bounded geometry, safe asset URL policy, expression limits, and target-specific action validation.
