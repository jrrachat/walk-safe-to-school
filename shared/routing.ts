import { z } from "zod";
export const factors = ["sidewalk", "crossings", "speed"] as const;
export type Factor = (typeof factors)[number];
export type Weights = Record<Factor, number>;
export const weightSchema = z.object(
  Object.fromEntries(
    factors.map((k) => [k, z.number().finite().min(0).max(10)]),
  ) as Record<Factor, z.ZodNumber>,
);
export const defaults: Weights = {
  sidewalk: 9,
  crossings: 7,
  speed: 6,
};
export const labels: Record<Factor, string> = {
  sidewalk: "Missing sidewalks",
  crossings: "Major-road crossings",
  speed: "Vehicle speeds",
};
export const requirementKeys = ["speed", "crosswalks", "sidewalks"] as const;
export type RequirementKey = (typeof requirementKeys)[number];
export type Requirements = Record<RequirementKey, boolean>;
export type RequirementCheck = { passes: boolean; applicable: boolean };
export type RequirementChecks = Record<RequirementKey, RequirementCheck>;
export type RouteCrossing = {
  coordinate: Coordinate;
  signalized: boolean;
  stopSign?: boolean;
  marked?: boolean;
};
export type RouteViolation = {
  coordinate: Coordinate;
  requirement: RequirementKey;
  label: string;
};
export const requirementSchema = z.object({
  speed: z.boolean(),
  crosswalks: z.boolean(),
  sidewalks: z.boolean(),
});
export const defaultRequirements: Requirements = {
  speed: false,
  crosswalks: false,
  sidewalks: false,
};
export const requirementLabels: Record<RequirementKey, string> = {
  speed: "No roads over 35 mph",
  crosswalks: "Crosswalks at required crossings",
  sidewalks: "Sidewalks along the route",
};
export const requirementFailureLabels: Record<RequirementKey, string> = {
  speed: "Over 35 mph",
  crosswalks: "Crosswalk missing",
  sidewalks: "Sidewalk missing",
};
export const requirementDescriptions: Record<RequirementKey, string> = {
  speed: "Every road segment has a mapped speed limit of 35 mph or less.",
  crosswalks: "Every detected road crossing uses a mapped crosswalk.",
  sidewalks:
    "Road segments have mapped sidewalks; walking-only paths also qualify.",
};
export const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type Coordinate = z.infer<typeof coordinateSchema>;
const featuresSchema = z.object(
  Object.fromEntries(
    factors.map((k) => [k, z.number().finite().min(0).max(1)]),
  ) as Record<Factor, z.ZodNumber>,
);
export const graphSchema = z.object({
  source: z.string(),
  demo: z.boolean(),
  nodes: z
    .array(z.object({ id: z.string(), coordinate: coordinateSchema }))
    .min(1),
  edges: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      name: z.string(),
      meters: z.number().finite().positive(),
      features: featuresSchema,
      geometry: z.array(coordinateSchema).min(2),
      bidirectional: z.boolean(),
    }),
  ),
});
export type Graph = z.infer<typeof graphSchema>;
export type Edge = Graph["edges"][number];
export type Category = "Fastest" | "Recommended" | "Lower Risk";
export const multipliers: Record<Category, number> = {
  Fastest: 0,
  Recommended: 3,
  "Lower Risk": 9,
};
export type Route = {
  category: Category;
  nodes: string[];
  edges: Edge[];
  coordinates: Coordinate[];
  meters: number;
  minutes: number;
  risk: number;
  cost: number;
  breakdown: Weights & { traffic?: number };
  duplicate: boolean;
  checks?: RequirementChecks;
  crossings?: RouteCrossing[];
  violations?: RouteViolation[];
};
export function distance(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const dlat = (b[1] - a[1]) * rad,
    dlon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function displayCrossings(
  crossings: RouteCrossing[],
  intersectionRadiusMeters = 30,
) {
  return crossings.reduce<RouteCrossing[]>((visible, crossing) => {
    const existing = visible.find(
      (candidate) =>
        distance(candidate.coordinate, crossing.coordinate) <=
        intersectionRadiusMeters,
    );
    if (existing) {
      existing.signalized ||= crossing.signalized;
      existing.stopSign ||= crossing.stopSign;
      existing.marked ||= crossing.marked;
    } else visible.push({ ...crossing });
    return visible;
  }, []);
}
// Fixed denominator preserves absolute strength: increasing every weight increases avoidance.
export function edgeRisk(edge: Edge, weights: Weights) {
  return (
    factors.reduce((sum, k) => sum + edge.features[k] * weights[k], 0) / 30
  );
}
export function validateGraph(input: unknown): Graph {
  const g = graphSchema.parse(input);
  const ids = new Set(g.nodes.map((n) => n.id));
  if (
    ids.size !== g.nodes.length ||
    new Set(g.edges.map((e) => e.id)).size !== g.edges.length
  )
    throw new Error("Duplicate graph IDs");
  for (const e of g.edges)
    if (!ids.has(e.from) || !ids.has(e.to))
      throw new Error("Unknown edge endpoint");
  return g;
}
export function nearestNode(graph: Graph, coordinate: Coordinate) {
  const sorted = graph.nodes
    .map((n) => ({ node: n, meters: distance(coordinate, n.coordinate) }))
    .sort((a, b) => a.meters - b.meters);
  if (!sorted[0] || sorted[0].meters > 250)
    throw new Error(
      "This point is outside the available pedestrian graph. Try a Midtown sample place. Atlanta-wide routing needs the production street graph.",
    );
  return sorted[0].node.id;
}
export function findRoute(
  graph: Graph,
  start: string,
  end: string,
  weights: Weights,
  category: Category,
): Route {
  weightSchema.parse(weights);
  if (
    !graph.nodes.some((n) => n.id === start) ||
    !graph.nodes.some((n) => n.id === end)
  )
    throw new Error("Unknown location");
  if (start === end) throw new Error("Choose two distinct graph locations.");
  const adjacency = new Map<
    string,
    { to: string; edge: Edge; reverse: boolean }[]
  >();
  for (const e of graph.edges) {
    adjacency.set(e.from, [
      ...(adjacency.get(e.from) || []),
      { to: e.to, edge: e, reverse: false },
    ]);
    if (e.bidirectional)
      adjacency.set(e.to, [
        ...(adjacency.get(e.to) || []),
        { to: e.from, edge: e, reverse: true },
      ]);
  }
  const costs = new Map<string, number>([[start, 0]]),
    previous = new Map<
      string,
      { from: string; edge: Edge; reverse: boolean }
    >(),
    visited = new Set<string>();
  // Dijkstra: all costs are positive; no heuristic assumptions about imported geometry.
  while (true) {
    let current: string | undefined,
      best = Infinity;
    for (const [id, cost] of costs)
      if (!visited.has(id) && cost < best) {
        current = id;
        best = cost;
      }
    if (current === undefined) break;
    if (current === end) break;
    visited.add(current);
    for (const next of adjacency.get(current) || []) {
      const cost =
        best +
        next.edge.meters *
          (1 + multipliers[category] * edgeRisk(next.edge, weights));
      if (cost < (costs.get(next.to) ?? Infinity)) {
        costs.set(next.to, cost);
        previous.set(next.to, {
          from: current,
          edge: next.edge,
          reverse: next.reverse,
        });
      }
    }
  }
  if (!previous.has(end))
    throw new Error("No connected walking route was found.");
  const edges: Edge[] = [],
    nodes = [end];
  let cursor = end;
  while (cursor !== start) {
    const p = previous.get(cursor)!;
    edges.unshift(
      p.reverse
        ? {
            ...p.edge,
            from: p.edge.to,
            to: p.edge.from,
            geometry: [...p.edge.geometry].reverse(),
          }
        : p.edge,
    );
    cursor = p.from;
    nodes.unshift(cursor);
  }
  const meters = edges.reduce((s, e) => s + e.meters, 0),
    breakdown = Object.fromEntries(
      factors.map((k) => [
        k,
        (edges.reduce(
          (s, e) => s + (e.meters * e.features[k] * weights[k]) / 30,
          0,
        ) /
          meters) *
          100,
      ]),
    ) as Weights;
  return {
    category,
    nodes,
    edges,
    coordinates: edges.flatMap((e, i) =>
      i ? e.geometry.slice(1) : e.geometry,
    ),
    meters,
    minutes: Math.ceil(meters / 75),
    risk: Math.round(factors.reduce((s, k) => s + breakdown[k], 0)),
    cost: costs.get(end)!,
    breakdown,
    duplicate: false,
  };
}
export function compareRoutes(
  graph: Graph,
  start: Coordinate,
  end: Coordinate,
  weights: Weights,
) {
  const a = nearestNode(graph, start),
    b = nearestNode(graph, end);
  const routes = (Object.keys(multipliers) as Category[]).map((c) =>
    findRoute(graph, a, b, weights, c),
  );
  return routes.map((r, i) => ({
    ...r,
    duplicate: routes
      .slice(0, i)
      .some((other) => other.nodes.join("|") === r.nodes.join("|")),
  }));
}

function demoRouteChecks(route: Route): RequirementChecks {
  const roadExposure = route.edges.filter(
    (edge) => edge.features.sidewalk > 0.12,
  );
  const crossingNeeded = roadExposure.length > 0;
  const mappedCrosswalks = roadExposure.every(
    (edge) => edge.features.crossings <= 0.25,
  );
  return {
    speed: {
      applicable: route.edges.length > 0,
      passes: route.edges.every((edge) => edge.features.speed <= 0.63),
    },
    sidewalks: {
      applicable: route.edges.length > 0,
      passes: route.edges.every((edge) => edge.features.sidewalk <= 0.12),
    },
    crosswalks: {
      applicable: crossingNeeded,
      passes: !crossingNeeded || mappedCrosswalks,
    },
  };
}

export function meetsRequirements(route: Route, required: Requirements) {
  const checks = route.checks || demoRouteChecks(route);
  return requirementKeys.every((key) => !required[key] || checks[key].passes);
}

export function requiredRoutes(
  graph: Graph,
  start: Coordinate,
  end: Coordinate,
  required: Requirements,
) {
  requirementSchema.parse(required);
  const candidates = compareRoutes(graph, start, end, defaults).map(
    (route) => ({
      ...route,
      checks: demoRouteChecks(route),
      crossings: [],
    }),
  );
  const qualifying = candidates.filter((route) =>
    meetsRequirements(route, required),
  );
  if (!qualifying.length) throw new Error("Route not possible.");
  const safest = [...qualifying].sort(
    (a, b) => a.risk - b.risk || a.minutes - b.minutes,
  )[0];
  return [{ ...safest, category: "Lower Risk" as Category }];
}
