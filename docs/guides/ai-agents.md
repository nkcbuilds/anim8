# AI Agent Authoring Guide

Anim8 is designed so a capable model can generate valid scenes without knowing renderer internals.

## Preferred workflow

1. Start with a small JSON or TypeScript scene.
2. Use stable explicit IDs.
3. Validate.
4. Repair only the fields identified by diagnostics.
5. Render representative timestamps.
6. Check semantic correctness, not just whether SVG was produced.

## Prefer JSON for generated/untrusted scenes

JSON is easy to validate and does not require evaluating generated code.

Use the TypeScript authoring API when a trusted developer wants ergonomic composition.

## Keep the vocabulary small

Prefer these concepts:

- create objects,
- connect them,
- move/rotate/scale,
- highlight/show/hide,
- sequence/parallel,
- named steps,
- layout.

Do not invent synonyms for existing actions.

## Example

```json
{
  "version": "1.0",
  "scene": { "width": 640, "height": 360, "theme": "clean" },
  "objects": [
    {
      "id": "request",
      "type": "rect",
      "width": 100,
      "height": 48,
      "text": "Request",
      "transform": {
        "x": 100, "y": 180,
        "rotation": 0,
        "scaleX": 1, "scaleY": 1,
        "opacity": 1
      },
      "style": { "fill": "#fff", "stroke": "#111827", "strokeWidth": 2 },
      "visible": true,
      "z": 1
    }
  ],
  "timeline": [
    {
      "id": "send",
      "type": "move",
      "target": "request",
      "start": 0,
      "duration": 800,
      "easing": "easeInOut",
      "to": { "x": 500, "y": 180 }
    }
  ]
}
```

## Repair loop

A diagnostic such as:

```json
{
  "code": "UNKNOWN_OBJECT",
  "path": "timeline[2].target",
  "message": "Object 'box3' does not exist."
}
```

means the repair should target that reference. Do not rewrite unrelated scene data unless necessary.

## Safety

Never put JavaScript, `eval`, event-handler strings, arbitrary HTML, or unsafe external URLs into scene documents.
