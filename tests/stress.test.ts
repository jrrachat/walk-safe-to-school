import { afterEach, expect, it, vi } from "vitest";
import {
  defaults,
  findRoute,
  type Coordinate,
  type Graph,
} from "../shared/routing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("routes across a 100 by 100 street grid", () => {
  const size = 100;
  const coordinate = (x: number, y: number): Coordinate => [
    x / 10000,
    y / 10000,
  ];
  const nodes: Graph["nodes"] = [];
  const edges: Graph["edges"] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      nodes.push({ id: `${x},${y}`, coordinate: coordinate(x, y) });
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        if (x + dx >= size || y + dy >= size) continue;
        edges.push({
          id: `${x},${y}-${dx},${dy}`,
          from: `${x},${y}`,
          to: `${x + dx},${y + dy}`,
          name: "Grid street",
          meters: 11,
          features: { sidewalk: 0, crossings: 0, speed: 0 },
          geometry: [coordinate(x, y), coordinate(x + dx, y + dy)],
          bidirectional: true,
        });
      }
    }
  const graph: Graph = { source: "stress", demo: true, nodes, edges };
  const route = findRoute(graph, "0,0", "99,99", defaults, "Lower Risk");
  expect(route.nodes).toHaveLength(199);
  expect(route.meters).toBe(2178);
  expect(route.coordinates[0]).toEqual(coordinate(0, 0));
  expect(route.coordinates.at(-1)).toEqual(coordinate(99, 99));
});

it("coalesces concurrent school directory loads into one upstream request", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      features: [
        {
          properties: { OBJECTID: 1, NAME: "Test School" },
          geometry: { type: "Point", coordinates: [-84.39, 33.78] },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { loadSchools } = await import("../server/live");
  const results = await Promise.all(
    Array.from({ length: 50 }, () => loadSchools()),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(results.every((places) => places[0]?.name === "Test School")).toBe(
    true,
  );
});
