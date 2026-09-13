import { expect, it } from "vitest";
import { routePadding } from "../src/lib/mapLayout";

it.each([
  [320, 250],
  [390, 300],
  [480, 240],
  [768, 360],
])("keeps the route visible in a %i by %i mobile map", (width, height) => {
  const padding = routePadding(width, height, false);
  expect(padding.left).toBe(padding.right);
  expect(width - padding.left - padding.right).toBeGreaterThanOrEqual(
    width / 2,
  );
  expect(height - padding.top - padding.bottom).toBeGreaterThanOrEqual(
    height / 2,
  );
});
it("uses the whole desktop map now that the panel is outside it", () => {
  const padding = routePadding(1280, 720, true);
  expect(padding.left).toBe(padding.right);
  expect(1280 - padding.left - padding.right).toBeGreaterThan(600);
});

it("keeps the route above the mobile bottom sheet", () => {
  const p = routePadding(390, 788, false, 425);
  expect(p.bottom).toBeGreaterThan(425);
  expect(788 - p.top - p.bottom).toBeGreaterThan(200);
});
