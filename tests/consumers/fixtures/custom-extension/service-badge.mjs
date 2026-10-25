/**
 * A trusted authoring extension composed entirely from public generic shapes.
 * It creates no new renderer or scene-object type.
 */
export function serviceBadge(builder, label, {
  id = "service",
  x = 160,
  y = 100,
  statusColor = "#22c55e",
} = {}) {
  const body = builder.box(label, {
    id: `${id}_body`,
    x,
    y,
    width: 180,
    height: 72,
    radius: 12,
    fill: "#ffffff",
  });
  const status = builder.circle("", {
    id: `${id}_status`,
    x: x + 68,
    y: y - 22,
    width: 14,
    height: 14,
    fill: statusColor,
    stroke: statusColor,
  });
  const group = builder.group([body, status], { id, x, y });
  return { group, body, status };
}
