import { scene } from "@anim8/authoring";
import { serviceBadge } from "./service-badge.mjs";

const builder = scene({ width: 640, height: 360 });
const api = serviceBadge(builder, "API", { id: "api", x: 140, y: 180 });
const db = serviceBadge(builder, "Database", { id: "db", x: 480, y: 180, statusColor: "#3b82f6" });

builder.connect(api.body, db.body, {
  from: "right",
  to: "left",
  kind: "routed",
});

builder.step("Move API", () => {
  builder.sequence(api.group.moveTo({ x: 220, y: 120 }, { duration: 500 }));
});

export const document = builder.toJSON();
