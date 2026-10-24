import { expect, it } from "vitest";
import {
  pointOnRoute,
  routePadding,
  sidewalkWarningOnRoute,
} from "../src/lib/mapLayout";
import type { Coordinate } from "../shared/routing";

it("places annotations on the displayed route and rejects unrelated streets", () => {
  const route: Coordinate[] = [
    [-84.39, 33.77],
    [-84.389, 33.77],
  ];
  const snapped = pointOnRoute([-84.3895, 33.7702], route);
  expect(snapped?.[0]).toBeCloseTo(-84.3895, 6);
  expect(snapped?.[1]).toBeCloseTo(33.77, 6);
  expect(pointOnRoute([-84.3895, 33.771], route)).toBeNull();
});

it("snaps a sidewalk warning onto the displayed route around a bend", () => {
  const route: Coordinate[] = [
    [-84.39, 33.77],
    [-84.389, 33.77],
    [-84.389, 33.771],
  ];
  const warning: Coordinate[] = [
    [-84.3895, 33.77004],
    [-84.38896, 33.7705],
  ];
  const line = sidewalkWarningOnRoute(warning, route);
  expect(line).toHaveLength(3);
  expect(line[0][1]).toBeCloseTo(33.77, 6);
  expect(line[1]).toEqual(route[1]);
  expect(line[2][0]).toBeCloseTo(-84.389, 6);
});

it("omits warning geometry that cannot be matched to the route", () => {
  const route: Coordinate[] = [
    [-84.39, 33.77],
    [-84.389, 33.77],
  ];
  const wrongStreet: Coordinate[] = [
    [-84.39, 33.771],
    [-84.389, 33.771],
  ];
  expect(sidewalkWarningOnRoute(wrongStreet, route)).toEqual([]);
});

it("omits a warning whose middle follows a different street", () => {
  const route: Coordinate[] = [
    [-84.39, 33.77],
    [-84.389, 33.77],
  ];
  const detour: Coordinate[] = [
    [-84.3899, 33.77],
    [-84.3899, 33.7704],
    [-84.3891, 33.7704],
    [-84.3891, 33.77],
  ];
  expect(sidewalkWarningOnRoute(detour, route)).toEqual([]);
});

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
