# Reactive Inputs

Portable scene files can bind visual properties to safe declarative expressions.

```json
{
  "state": { "index": 0 },
  "bindings": [
    {
      "id": "pointer-x",
      "target": { "objectId": "pointer", "property": "x" },
      "expression": {
        "kind": "op",
        "op": "add",
        "args": [
          { "kind": "literal", "value": 150 },
          {
            "kind": "op",
            "op": "mul",
            "args": [
              { "kind": "get", "path": "inputs.index" },
              { "kind": "literal", "value": 100 }
            ]
          }
        ]
      }
    }
  ]
}
```

At runtime:

```ts
controller.setInput("index", 3);
```

The player re-evaluates the scene at the current timeline timestamp. Bindings do not execute arbitrary JavaScript and cannot access browser globals.

## Declarative interactions

Scene state can also change through a small serializable interaction vocabulary:

```json
{
  "state": { "count": 0, "active": false },
  "interactions": [
    {
      "id": "increment-on-click",
      "event": { "type": "click", "target": "counter" },
      "actions": [
        { "type": "increment", "key": "count", "by": 1 },
        { "type": "toggle", "key": "active" }
      ]
    },
    {
      "id": "reset",
      "event": { "type": "custom", "name": "reset" },
      "actions": [
        { "type": "set", "key": "count", "value": 0 }
      ]
    }
  ]
}
```

Built-in object events currently cover click, focus, and hover. Custom named events can be dispatched through the player:

```ts
controller.dispatch("reset");
```

Only keys declared in `scene.state` can be changed. State actions are bounded, deterministic data operations (`set`, `toggle`, and `increment`); they are not callbacks or executable code.
