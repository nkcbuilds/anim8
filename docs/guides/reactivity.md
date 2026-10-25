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
