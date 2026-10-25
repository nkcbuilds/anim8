# Architecture flow example

A public-API reference animation for a simple:

```text
Client  ->  API server  ->  Database
```

The scene is authored with `@anim8/authoring` plus the `server`, `database`, and `table` presets from `@anim8/presets`. It does not hand-author internal `SceneDocument` objects.

## What it demonstrates

- A client, API server, and database connected with real connector objects.
- Connector endpoints attached to preset anchor shapes.
- A physical `GET /users` request object following a multi-point path.
- A physical SQL query object following a second path.
- A table-shaped rows payload returning from the database, then continuing to the client.
- Deterministic `spring` easing on `followPath` and `moveTo`.
- The API server preset rearranging upward and later restoring its position.
- Connector attachment surviving that server-group movement because the connector points at `api.anchor`, whose shape remains parented to `api.group`.
- Named timeline steps/markers for presentation controls.
- A final client pulse when the rows arrive.

The generated timeline contains these named steps:

1. Request leaves client
2. API rearranges for work
3. Query travels to database
4. Rows return to API
5. API restores architecture
6. Rows reach client
7. Client receives result

## Files

- `build-scene.mjs` — source-of-truth authoring script.
- `scene.json` — generated `SceneDocument`.
- `verify.mjs` — semantic assertions against the built compiler.
- `preview.svg` — CLI-rendered frame at 1550ms, after the API server has rearranged.

## Public API shape

In an installed application, the imports used by the example are:

```js
import { scene } from "@anim8/authoring";
import { database, server, table } from "@anim8/presets";
```

The repository root intentionally does not depend on its own workspace packages, so `build-scene.mjs` points at those packages' built public entrypoints under `packages/*/dist`. The APIs used in the body of the example are the same exported APIs consumers use.

The important composition pattern is:

```js
const animation = scene({ width: 960, height: 540 });

const api = server(animation, "API", { id: "api", x: 460, y: 270 });
const db = database(animation, "Database", { id: "database", x: 800, y: 270 });

animation.connect(api.anchor, db.anchor, {
  from: "right",
  to: "left",
  label: "SQL",
});

animation.step("API rearranges for work", () => {
  animation.parallel(
    api.group.moveTo(
      { x: 460, y: 170 },
      { duration: 650, easing: "spring" },
    ),
  );
});
```

For moving payloads, `followPath` stays on the public handle:

```js
animation.step("Query travels to database", () => {
  animation.sequence(
    query.followPath(
      [
        { x: 460, y: 300 },
        { x: 625, y: 225 },
        { x: 800, y: 320 },
      ],
      { duration: 900, easing: "spring" },
    ),
  );
});
```

## Generate and validate

Build the workspace first so the example consumes the same distributable entrypoints a package consumer receives:

```sh
pnpm build
```

Regenerate the JSON:

```sh
node examples/architecture-flow/build-scene.mjs
```

Validate it through the built CLI/compiler:

```sh
node packages/cli/dist/cli.js validate examples/architecture-flow/scene.json
node examples/architecture-flow/verify.mjs
```

Render the reference frame:

```sh
node packages/cli/dist/cli.js render \
  examples/architecture-flow/scene.json \
  1550 \
  examples/architecture-flow/preview.svg
```

Expected validation output includes:

```text
{"ok":true,"diagnostics":[]}
PASS architecture-flow public API example
```
