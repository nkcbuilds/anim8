# Reactive input example

The `pointer` object's X position is bound to `inputs.index` through the safe declarative expression AST.

In the browser player:

```ts
controller.setInput("index", 3);
```

This re-evaluates the scene at the current timeline timestamp. It does not mutate SVG/DOM state directly.
