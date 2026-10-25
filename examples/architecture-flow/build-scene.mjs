import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This repository root intentionally does not depend on its workspace packages,
// so the checked-in example runner targets their built public entrypoints.
// In an installed app these are simply:
//   import { scene } from "@anim8/authoring";
//   import { database, server, table } from "@anim8/presets";
import { scene } from "../../packages/authoring/dist/index.js";
import { database, server, table } from "../../packages/presets/dist/index.js";

export function buildArchitectureFlow() {
  const animation = scene({
    width: 960,
    height: 540,
    theme: "clean",
    background: "#f8fafc",
    seed: 42,
  });

  // Architecture nodes.
  const client = animation.box("Client", {
    id: "client",
    x: 120,
    y: 270,
    width: 150,
    height: 90,
    fill: "#eff6ff",
    stroke: "#2563eb",
    strokeWidth: 2,
    radius: 16,
  });

  const api = server(animation, "API", {
    id: "api",
    x: 460,
    y: 270,
    width: 150,
    height: 100,
    fill: "#f0fdf4",
    stroke: "#16a34a",
    strokeWidth: 2,
  });

  const db = database(animation, "Database", {
    id: "database",
    x: 800,
    y: 270,
    width: 150,
    height: 110,
    fill: "#f5f3ff",
    stroke: "#7c3aed",
    strokeWidth: 2,
  });

  // Connect to the preset's real anchor child, not to an implementation-only
  // shape. Because that child belongs to api.group, this endpoint follows the
  // server when the group is rearranged below.
  animation.connect(client, api.anchor, {
    from: "right",
    to: "left",
    kind: "straight",
    label: "HTTP",
  });
  animation.connect(api.anchor, db.anchor, {
    from: "right",
    to: "left",
    kind: "straight",
    label: "SQL",
  });

  // Physical payload objects. These are ordinary public authoring/preset
  // handles, so the animation moves the objects themselves rather than faking
  // motion in renderer-only state.
  const request = animation.box("GET /users", {
    id: "request",
    x: 120,
    y: 390,
    width: 120,
    height: 38,
    fill: "#dbeafe",
    stroke: "#2563eb",
    radius: 18,
  });

  const query = animation.box("SELECT *", {
    id: "query",
    x: 460,
    y: 300,
    width: 120,
    height: 38,
    fill: "#dcfce7",
    stroke: "#16a34a",
    radius: 18,
  });

  const rows = table(
    animation,
    [
      ["id", "name"],
      ["1", "Ada"],
      ["2", "Lin"],
    ],
    {
      id: "rows",
      x: 800,
      y: 400,
      cellWidth: 58,
      cellHeight: 30,
      fill: "#faf5ff",
      stroke: "#7c3aed",
      strokeWidth: 1.5,
    },
  );

  animation.step("Request leaves client", () => {
    animation.sequence(
      request.followPath(
        [
          { x: 120, y: 390 },
          { x: 250, y: 335 },
          { x: 460, y: 300 },
        ],
        { duration: 900, easing: "spring" },
      ),
    );
  });

  animation.step("API rearranges for work", () => {
    animation.parallel(
      api.group.moveTo(
        { x: 460, y: 170 },
        { duration: 650, easing: "spring" },
      ),
      request.moveTo(
        { x: 460, y: 250 },
        { duration: 650, easing: "spring" },
      ),
    );
  });

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

  animation.step("Rows return to API", () => {
    animation.sequence(
      rows.group.followPath(
        [
          { x: 800, y: 400 },
          { x: 650, y: 350 },
          { x: 460, y: 300 },
        ],
        { duration: 1000, easing: "spring" },
      ),
    );
  });

  animation.step("API restores architecture", () => {
    animation.parallel(
      api.group.moveTo(
        { x: 460, y: 270 },
        { duration: 650, easing: "spring" },
      ),
      rows.group.moveTo(
        { x: 460, y: 390 },
        { duration: 650, easing: "spring" },
      ),
    );
  });

  animation.step("Rows reach client", () => {
    animation.sequence(
      rows.group.followPath(
        [
          { x: 460, y: 390 },
          { x: 300, y: 360 },
          { x: 120, y: 390 },
        ],
        { duration: 900, easing: "spring" },
      ),
    );
  });

  animation.step("Client receives result", () => {
    client.pulse({ duration: 420, scale: 1.08, easing: "spring" });
  });

  return animation.toJSON();
}

const outputUrl = process.argv[2]
  ? pathToFileURL(resolve(process.cwd(), process.argv[2]))
  : new URL("./scene.json", import.meta.url);

const document = buildArchitectureFlow();
await writeFile(
  fileURLToPath(outputUrl),
  `${JSON.stringify(document, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${fileURLToPath(outputUrl)}`);
