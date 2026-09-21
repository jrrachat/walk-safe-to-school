// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { Map as RouteMap } from "maplibre-gl";
import { renderRouteCard } from "../src/lib/routeExport";
import type { Route } from "../shared/routing";
import type { Place } from "../shared/demo";

const route: Route = {
  category: "Lower Risk",
  nodes: [],
  edges: [],
  coordinates: [
    [-84.3867, 33.781],
    [-84.3727, 33.7808],
  ],
  meters: 1320,
  minutes: 18,
  risk: 0,
  cost: 1320,
  breakdown: { sidewalk: 0, crossings: 0, speed: 0 },
  duplicate: false,
};
const start: Place = {
  id: "home",
  name: "Home",
  kind: "Home",
  area: "Atlanta",
  coordinate: route.coordinates[0],
};
const end: Place = {
  ...start,
  id: "school",
  name: "School",
  kind: "School",
  coordinate: route.coordinates[1],
};
function setup(complete = true) {
  const handlers = new Map<string, () => void>();
  const container = document.createElement("div");
  container.style.width = "390px";
  const source = document.createElement("canvas");
  Object.defineProperties(source, {
    clientWidth: { value: 1200 },
    clientHeight: { value: 850 },
  });
  const ctx = Object.fromEntries(
    [
      "fillRect",
      "drawImage",
      "beginPath",
      "arc",
      "fill",
      "stroke",
      "fillText",
      "save",
      "restore",
      "translate",
      "moveTo",
      "lineTo",
      "closePath",
    ].map((name) => [name, vi.fn()]),
  );
  ctx.measureText = vi.fn(() => ({ width: 100 }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  const camera = {
    center: { lng: -84.38, lat: 33.78 },
    zoom: 14,
    bearing: 67,
    pitch: 30,
    padding: { top: 10, right: 20, bottom: 30, left: 40 },
  };
  const map = {
    getCenter: () => camera.center,
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    getPadding: () => camera.padding,
    getContainer: () => container,
    getStyle: () => ({
      sources: {
        osm: {
          attribution:
            '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
    }),
    getCanvas: () => source,
    project: () => ({ x: 100, y: 100 }),
    resize: vi.fn(),
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    on: (event: string, fn: () => void) => handlers.set(event, fn),
    off: (event: string) => handlers.delete(event),
    triggerRepaint: () => {
      if (complete) queueMicrotask(() => handlers.get("idle")?.());
    },
  };
  return { map, camera, container, handlers, ctx };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("exports the full route north-up and restores a rotated phone map", async () => {
  const { map, camera, container, handlers, ctx } = setup();
  const canvas = await renderRouteCard(
    map as unknown as RouteMap,
    route,
    start,
    end,
  );
  expect([canvas.width, canvas.height]).toEqual([1600, 1393]);
  const [bounds, options] = map.fitBounds.mock.calls[0];
  expect(bounds.toArray()).toEqual([
    [-84.3867, 33.7808],
    [-84.3727, 33.781],
  ]);
  expect(options).toMatchObject({ bearing: 0, pitch: 0, duration: 0 });
  expect(ctx.drawImage).toHaveBeenCalled();
  expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual(
    expect.arrayContaining(["N", "S", "E", "W", "A", "B"]),
  );
  expect(map.jumpTo).toHaveBeenLastCalledWith(camera);
  expect(container.style.width).toBe("390px");
  expect(container.style.height).toBe("");
  expect(handlers.size).toBe(0);
});
it("restores the map and removes listeners when tiles time out", async () => {
  vi.useFakeTimers();
  const { map, camera, container, handlers } = setup(false);
  const promise = renderRouteCard(
    map as unknown as RouteMap,
    route,
    start,
    end,
  );
  const rejection = expect(promise).rejects.toThrow(
    "map could not finish loading",
  );
  await vi.advanceTimersByTimeAsync(20000);
  await rejection;
  expect(map.jumpTo).toHaveBeenLastCalledWith(camera);
  expect(container.style.width).toBe("390px");
  expect(handlers.size).toBe(0);
});
it("does not capture an incomplete route", async () => {
  const { map } = setup();
  await expect(
    renderRouteCard(
      map as unknown as RouteMap,
      { ...route, coordinates: [] },
      start,
      end,
    ),
  ).rejects.toThrow("Wait for the walking route");
  expect(map.fitBounds).not.toHaveBeenCalled();
});
