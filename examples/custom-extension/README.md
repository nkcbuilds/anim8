# Custom authoring extension

This example demonstrates Anim8's trusted custom-shape extension boundary.

`serviceBadge()` is ordinary application/library code. It composes a rectangle,
status circle, and group through `@anim8/authoring`; the resulting scene
contains only standard serializable Anim8 objects. The extension therefore:

- works with every renderer that supports the generic primitives;
- preserves normal IDs, grouping, actions, connectors, and validation;
- adds no executable plugin payload to scene JSON;
- needs no changes to core, compiler, or renderer packages.

This is the preferred pattern for custom semantic diagram objects. New core
object types are only appropriate when a genuinely new evaluated visual
primitive cannot be expressed by existing shapes.
