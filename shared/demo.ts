import { distance, type Coordinate, type Graph } from "./routing";
export type Place = {
  id: string;
  name: string;
  kind: string;
  coordinate: Coordinate;
  area: string;
};
export const places: Place[] = [
  {
    id: "midtown-station",
    name: "Midtown MARTA",
    kind: "Transit",
    coordinate: [-84.3867, 33.781],
    area: "Midtown",
  },
  {
    id: "piedmont-park",
    name: "Piedmont Park",
    kind: "Park",
    coordinate: [-84.378, 33.7869],
    area: "14th Street entrance",
  },
  {
    id: "school",
    name: "Midtown High School",
    kind: "School",
    coordinate: [-84.3727, 33.7808],
    area: "Midtown",
  },
  {
    id: "library",
    name: "Peachtree Branch Library",
    kind: "Library",
    coordinate: [-84.3856, 33.7999],
    area: "Outside sample graph",
  },
  {
    id: "centennial",
    name: "Centennial Olympic Park",
    kind: "Park",
    coordinate: [-84.3938, 33.7603],
    area: "Downtown · outside sample graph",
  },
  {
    id: "five-points",
    name: "Five Points MARTA",
    kind: "Transit",
    coordinate: [-84.3915, 33.754],
    area: "Downtown · outside sample graph",
  },
  {
    id: "grant-park",
    name: "Grant Park",
    kind: "Park",
    coordinate: [-84.3738, 33.7372],
    area: "Outside sample graph",
  },
];
// Synthetic topology and factors. Coordinates provide a recognizable Midtown demonstration,
// but edges do not assert verified sidewalks, crossings, public access, or navigability.
const cols = [-84.3867, -84.3838, -84.381, -84.378, -84.3727],
  rows = [33.781, 33.7828, 33.7849, 33.7869];
const nodes = rows.flatMap((lat, y) =>
  cols.map((lon, x) => ({
    id: `${x}-${y}`,
    coordinate: [lon, lat] as Coordinate,
  })),
);
const edges: Graph["edges"] = [];
for (let y = 0; y < rows.length; y++)
  for (let x = 0; x < cols.length; x++)
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      if (x + dx >= cols.length || y + dy >= rows.length) continue;
      const a = nodes.find((n) => n.id === `${x}-${y}`)!,
        b = nodes.find((n) => n.id === `${x + dx}-${y + dy}`)!;
      const level = y === 0 ? 0.92 : y === 1 ? 0.45 : y === 2 ? 0.04 : 0.01;
      const sidewalk = x === 0 ? 0.72 : 0.1,
        crossing = y === 0 ? 0.85 : 0.12;
      edges.push({
        id: `${a.id}_${b.id}`,
        from: a.id,
        to: b.id,
        name: dy
          ? [
              "West corridor",
              "Juniper corridor",
              "Piedmont corridor",
              "Park corridor",
              "East corridor",
            ][x]
          : [
              "10th St sample",
              "11th St sample",
              "12th St sample",
              "14th St sample",
            ][y],
        meters: Math.round(distance(a.coordinate, b.coordinate) * 1.06),
        geometry: [a.coordinate, b.coordinate],
        bidirectional: true,
        features: {
          sidewalk,
          crossings: crossing,
          speed: level,
        },
      });
    }
export const demoGraph: Graph = {
  source: "Synthetic Midtown demonstration · not verified for navigation",
  demo: true,
  nodes,
  edges,
};
