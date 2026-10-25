# Binary search reference scene

This scene searches the sorted array `[3, 7, 11, 18, 24, 31, 42]` for `24`.

## Demonstrates

- Stable IDs for array cells so values keep their visual identity.
- `text` objects used as low, mid, and high pointers.
- Sequenced `move` actions that shrink the active search interval.
- `fill` and `stroke` actions to distinguish inspected and found values.
- A deterministic scene seed using only SceneDocument 1.0 data.

## Current limitations

- There is no algorithm/control-flow primitive: the search steps are authored explicitly on the timeline.
- Timeline actions cannot change text content, so the pointer labels stay fixed and only their positions move.
- There is no built-in array/index layout primitive in SceneDocument 1.0; cell positions are explicit coordinates.
- The scene does not derive pointer positions from values at runtime; a model or author must generate those steps.
