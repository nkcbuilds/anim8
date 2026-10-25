# Linked-list reference scene

This scene represents `10 -> 20 -> 30 -> 40 -> NULL` and animates a traversal cursor from head to tail.

## Demonstrates

- `rect` nodes with persistent IDs.
- `connector` objects using stable node references and left/right anchors.
- A traversal cursor implemented as a moving `text` object.
- Sequenced `move` and `fill` actions for traversal state.
- Connectors remain defined by object references rather than copied endpoint coordinates.

## Current limitations

- Connector endpoints are static references in SceneDocument 1.0; the timeline cannot retarget a connector.
- Therefore insertion/deletion and pointer rewiring are not modeled dynamically in this example.
- There is no linked-list or automatic layout primitive; node positions and edges are authored explicitly.
- `NULL` is a text label, not a first-class pointer/null endpoint object.
