# Timeline Semantics

Anim8 timelines are evaluated from absolute time, not by replaying previous frames.

## Primitive actions

Current primitive actions include:

- `move`
- `followPath`
- `rotate`
- `scale`
- `resize`
- `opacity`
- `fill`
- `stroke`
- `visibility`
- `draw`
- `camera`

Object actions have an `id`, `target`, `start`, and `duration`. Scene-level `camera` actions intentionally have no object target.

## Random-access evaluation

```ts
const frame = evaluate(scene, 750);
```

The result at 750 ms is independent of whether 0 ms, 500 ms, or 5 seconds was evaluated previously.

## Parallel actions

Actions may overlap if they affect different properties. For example, a move and rotation may run together.

## Conflicts

Two overlapping actions writing the same property are rejected by validation in v1.

This is deliberate. Silent last-callback-wins behavior would make model-generated scenes hard to reason about and repair.

## Zero-duration actions

Visibility changes may have zero duration and behave as time-based steps.

## Movement

`move` supports straight motion plus deterministic `arc-up` / `arc-down` quadratic trajectories.

`followPath` uses explicit polyline points in transform coordinate space:

```json
{
  "id": "travel",
  "type": "followPath",
  "target": "packet",
  "start": 0,
  "duration": 1200,
  "easing": "spring",
  "points": [
    { "x": 80, "y": 180 },
    { "x": 280, "y": 80 },
    { "x": 560, "y": 180 }
  ]
}
```

Progress is evaluated by cumulative arc length. No DOM or SVG path measurement is used, so seeking and headless evaluation remain deterministic.

## Easing

Supported v1 easing names are `linear`, `easeIn`, `easeOut`, `easeInOut`, and `spring`.

The spring easing is a fixed normalized damped function, not a frame-integrated simulation. It has exact 0/1 endpoints and can therefore be sampled at arbitrary times reproducibly.

## Resize

`resize` changes intrinsic geometry rather than transform scale.

- rect/image: width + height
- ellipse: rx/ry derived from target width/height
- circle: equal width/height only

Unsupported resize targets are rejected.

## Stroke reveal

`draw` animates normalized `drawProgress` for paths, polygons, and polylines. Its target value is constrained to `0..1`.

## Authoring-only helpers

Helpers such as `pulse` and `shake` compile to ordinary primitive scale/move actions. They do not introduce renderer-specific effect state.

## Camera

`camera` animates scene-level pan/zoom using absolute `x`, `y`, and `zoom` values. It is sampled from absolute timeline time and therefore obeys the same seek/reverse determinism as object actions.

## Playback

The browser player supplies play, pause, seek, reverse, restart, speed, named-step navigation, looping, reactive inputs, and safe declarative interaction dispatch while delegating semantic frame evaluation back to the core.

## Future composition

A later IR version may add explicit effect stacks/composition such as replace/add/multiply. That will be versioned rather than introduced as an implicit runtime rule.
