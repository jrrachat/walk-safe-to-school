import { describe, it, expect } from "vitest";
import {
  compareRoutes,
  defaultRequirements,
  defaults,
  displayCrossings,
  findRoute,
  requiredRoutes,
  validateGraph,
  weightSchema,
  type Graph,
} from "../shared/routing";
import { demoGraph, places } from "../shared/demo";
const feature = (risk: number) => ({
  sidewalk: risk,
  crossings: risk,
  speed: risk,
});
const graph: Graph = {
  demo: true,
  source: "test",
  nodes: [
    { id: "a", coordinate: [0, 0] },
    { id: "b", coordinate: [0.001, 0] },
    { id: "c", coordinate: [0, 0.001] },
  ],
  edges: [
    {
      id: "direct",
      from: "a",
      to: "b",
      meters: 100,
      name: "direct",
      features: feature(1),
      geometry: [
        [0, 0],
        [0.001, 0],
      ],
      bidirectional: false,
    },
    {
      id: "detour1",
      from: "a",
      to: "c",
      meters: 80,
      name: "detour",
      features: feature(0),
      geometry: [
        [0, 0],
        [0, 0.001],
      ],
      bidirectional: true,
    },
    {
      id: "detour2",
      from: "c",
      to: "b",
      meters: 80,
      name: "detour",
      features: feature(0),
      geometry: [
        [0, 0.001],
        [0.001, 0],
      ],
      bidirectional: false,
    },
  ],
};
describe("weighted Dijkstra", () => {
  it("chooses shortest distance for Fastest and avoids high risk when weighted", () => {
    expect(findRoute(graph, "a", "b", defaults, "Fastest").nodes).toEqual([
      "a",
      "b",
    ]);
    expect(findRoute(graph, "a", "b", defaults, "Recommended").nodes).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
  it("changes the route when parents reduce every weight to zero", () => {
    expect(findRoute(graph, "a", "b", feature(0), "Recommended").nodes).toEqual(
      ["a", "b"],
    );
  });
  it("respects directionality and disconnected destinations", () => {
    expect(() => findRoute(graph, "b", "a", defaults, "Fastest")).toThrow(
      "No connected",
    );
  });
  it("rejects invalid and negative weights", () => {
    expect(() => weightSchema.parse({ ...defaults, sidewalk: -1 })).toThrow();
    expect(() =>
      weightSchema.parse({ ...defaults, speed: Infinity }),
    ).toThrow();
  });
  it("handles invalid endpoints and identical snapped nodes", () => {
    expect(() => findRoute(graph, "z", "a", defaults, "Fastest")).toThrow(
      "Unknown",
    );
    expect(() => findRoute(graph, "a", "a", defaults, "Fastest")).toThrow(
      "distinct",
    );
  });
  it("refuses distant graph snaps rather than inventing a walking connection", () => {
    expect(() =>
      compareRoutes(
        demoGraph,
        places[0].coordinate,
        places[4].coordinate,
        defaults,
      ),
    ).toThrow("outside");
  });
  it("keeps scores finite, bounded, and risk contributions additive", () => {
    for (const route of compareRoutes(
      demoGraph,
      places[0].coordinate,
      places[1].coordinate,
      defaults,
    )) {
      expect(route.risk).toBeGreaterThanOrEqual(0);
      expect(route.risk).toBeLessThanOrEqual(100);
      expect(
        Math.round(Object.values(route.breakdown).reduce((a, b) => a + b, 0)),
      ).toBe(route.risk);
      expect(route.coordinates[0]).toEqual(places[0].coordinate);
    }
  });
  it("discloses identical routes", () => {
    const routes = compareRoutes(
      demoGraph,
      places[0].coordinate,
      places[1].coordinate,
      feature(0),
    );
    expect(routes.map((r) => r.duplicate)).toEqual([false, true, true]);
  });
  it("rejects a route that misses a checked requirement", () => {
    const noSidewalkGraph: Graph = {
      ...graph,
      nodes: graph.nodes.slice(0, 2),
      edges: [
        {
          ...graph.edges[0],
          features: { sidewalk: 1, crossings: 0, speed: 0 },
        },
      ],
    };
    expect(() =>
      requiredRoutes(noSidewalkGraph, [0, 0], [0.001, 0], {
        ...defaultRequirements,
        sidewalks: true,
      }),
    ).toThrow("Route not possible.");
  });
  it("does not require a crosswalk when no road crossing is needed", () => {
    const continuousPath: Graph = {
      ...graph,
      nodes: graph.nodes.slice(0, 2),
      edges: [
        {
          ...graph.edges[0],
          features: { sidewalk: 0, crossings: 0, speed: 0 },
        },
      ],
    };
    expect(
      requiredRoutes(continuousPath, [0, 0], [0.001, 0], {
        ...defaultRequirements,
        crosswalks: true,
      }),
    ).toHaveLength(1);
  });
  it("validates graph references and IDs", () => {
    expect(() =>
      validateGraph({
        ...graph,
        edges: [{ ...graph.edges[0], from: "missing" }],
      }),
    ).toThrow("Unknown edge");
    expect(() =>
      validateGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }),
    ).toThrow("Duplicate");
  });
});

it("demonstrates the time and risk tradeoff for the default school trip", () => {
  const routes = compareRoutes(
    demoGraph,
    places[0].coordinate,
    places[2].coordinate,
    defaults,
  );
  expect(routes[1].minutes).toBeGreaterThan(routes[0].minutes);
  expect(routes[2].minutes).toBeGreaterThanOrEqual(routes[1].minutes);
  expect(routes[1].risk).toBeLessThan(routes[0].risk);
  expect(routes[2].risk).toBeLessThanOrEqual(routes[1].risk);
});

it("shows one crossing label for nearby edges at the same intersection", () => {
  const visible = displayCrossings([
    { coordinate: [-84.39001, 33.77001], signalized: false },
    { coordinate: [-84.39002, 33.77002], signalized: true },
    { coordinate: [-84.385, 33.775], signalized: false },
  ]);
  expect(visible).toHaveLength(2);
  expect(visible[0].signalized).toBe(true);
});
