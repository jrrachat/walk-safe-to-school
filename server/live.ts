import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Place } from "../shared/demo";
import { schools as fallbackSchools, isAtlantaSchool } from "../shared/schools";
import {
  coordinateSchema,
  defaults,
  distance,
  factors,
  meetsRequirements,
  requirementFailureLabels,
  requirementKeys,
  type Category,
  type Coordinate,
  type Edge,
  type RequirementChecks,
  type RequirementKey,
  type Requirements,
  type Route,
  type RouteCrossing,
  type RouteViolation,
  type Weights,
} from "../shared/routing";

const directoryUrl =
  process.env.SCHOOL_DIRECTORY_URL ||
  "https://services1.arcgis.com/AQDHTHDrZzfsFsB5/ArcGIS/rest/services/pubgis_DBO_Education_Schools/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CSch_Year%2CNAME%2CType%2COperator%2CAddress%2CCity%2CZipCode&returnGeometry=true&outSR=4326&f=geojson";
const autocompleteUrl =
  process.env.AUTOCOMPLETE_SEARCH_URL || "https://photon.komoot.io/api";
const reverseUrl =
  process.env.GEOCODER_REVERSE_URL ||
  "https://nominatim.openstreetmap.org/reverse";
const routingUrl =
  process.env.ROUTING_URL || "https://valhalla1.openstreetmap.de/route";
const routeAttributesUrl =
  process.env.ROUTE_ATTRIBUTES_URL ||
  routingUrl.replace(/\/route\/?$/, "/trace_attributes");
const sidewalkDataUrl =
  process.env.SIDEWALK_DATA_URL || "https://overpass-api.de/api/interpreter";
const atlantaSidewalkDataUrl =
  process.env.ATLANTA_SIDEWALK_DATA_URL ||
  "https://services2.arcgis.com/zLeajbicrDRLQcny/ArcGIS/rest/services/Sidewalks_Inventory/FeatureServer/2/query";
const trafficSignalsDataUrl =
  process.env.TRAFFIC_SIGNALS_DATA_URL ||
  "https://dpwgis.atlantaga.gov/hostingserver/rest/services/Signalized_Intersections/FeatureServer/0/query";
const gdotTrafficDataPath =
  process.env.GDOT_TRAFFIC_DATA_PATH ||
  new URL("./data/gdot-traffic-2025.json", import.meta.url);
const clientId =
  process.env.SERVICE_CLIENT_ID || "walkwise-atlanta-development";
const atlanta = { south: 33.65, west: -84.56, north: 33.92, east: -84.27 };
const schoolCache: { expires: number; places: Place[] } = {
  expires: 0,
  places: fallbackSchools,
};
const searchCache = new Map<string, { expires: number; places: Place[] }>();
const trafficDataSchema = z.object({
  source: z.string(),
  sourceUrl: z.string().url(),
  year: z.number().int(),
  downloadPublished: z.string(),
  stations: z.array(
    z.object({
      id: z.string(),
      coordinate: coordinateSchema,
      aadt: z.number().nonnegative(),
      functionalClass: z.number().int().min(1).max(7),
      statisticsType: z.string(),
    }),
  ),
});
export type TrafficStation = z.infer<
  typeof trafficDataSchema
>["stations"][number];
const trafficData = trafficDataSchema.parse(
  JSON.parse(readFileSync(gdotTrafficDataPath, "utf8")),
);
type TrafficGrid = Map<string, TrafficStation[]>;
const trafficGridCellDegrees = 0.01;
function trafficGridKey([lon, lat]: Coordinate) {
  return (
    Math.floor(lon / trafficGridCellDegrees) +
    ":" +
    Math.floor(lat / trafficGridCellDegrees)
  );
}
function buildTrafficGrid(stations: TrafficStation[]) {
  const grid: TrafficGrid = new Map();
  for (const station of stations) {
    const key = trafficGridKey(station.coordinate);
    grid.set(key, [...(grid.get(key) || []), station]);
  }
  return grid;
}
const trafficGrid = buildTrafficGrid(trafficData.stations);
type AttributeAudit = {
  features: Weights;
  checks: RequirementChecks;
  crossings: RouteCrossing[];
  violations: Partial<Record<RequirementKey, Coordinate[]>>;
  violationDetails: Partial<Record<RequirementKey, RouteViolation[]>>;
  alerts: RouteViolation[];
};
type RouteAnalysis = AttributeAudit & {
  traffic: number;
  busyRoadLocations: Coordinate[];
};
const routeFeatureCache = new Map<
  string,
  { expires: number; analyses: (RouteAnalysis | undefined)[] }
>();
let lastGeocoderRequest = 0;

function serviceHeaders() {
  return {
    "User-Agent": clientId,
    Referer: "http://localhost",
  };
}
function geocoderHeaders(url: URL) {
  const publicHosts = new Set([
    "photon.komoot.io",
    "nominatim.openstreetmap.org",
  ]);
  return {
    ...serviceHeaders(),
    ...(process.env.GEOCODER_TOKEN && !publicHosts.has(url.hostname)
      ? { Authorization: "Bearer " + process.env.GEOCODER_TOKEN }
      : {}),
  };
}
async function pacedFetch(url: URL, timeout = 10000) {
  if (url.hostname === "nominatim.openstreetmap.org") {
    const wait = Math.max(0, 1050 - (Date.now() - lastGeocoderRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastGeocoderRequest = Date.now();
  }
  return fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: geocoderHeaders(url),
  });
}

export async function loadSchools() {
  if (schoolCache.expires > Date.now()) return schoolCache.places;
  const response = await fetch(directoryUrl, {
    signal: AbortSignal.timeout(20000),
    headers: serviceHeaders(),
  });
  if (!response.ok) throw new Error("Live school directory unavailable");
  const payload = z
    .object({
      features: z.array(
        z.object({
          properties: z.object({
            OBJECTID: z.number(),
            Sch_Year: z.string().nullable().optional(),
            NAME: z.string(),
            Type: z.string().nullable().optional(),
            Operator: z.string().nullable().optional(),
            Address: z.string().nullable().optional(),
            City: z.string().nullable().optional(),
            ZipCode: z.string().nullable().optional(),
          }),
          geometry: z.object({
            type: z.literal("Point"),
            coordinates: z.tuple([z.number(), z.number()]),
          }),
        }),
      ),
    })
    .parse(await response.json());
  const places = payload.features
    .map((feature): Place => ({
      id: "atl-school-" + feature.properties.OBJECTID,
      name: feature.properties.NAME,
      kind: "School",
      coordinate: feature.geometry.coordinates,
      area:
        [
          feature.properties.Address,
          feature.properties.City,
          feature.properties.ZipCode,
        ]
          .filter(Boolean)
          .join(", ") || "Atlanta area",
    }))
    .filter(isAtlantaSchool)
    .sort((a, b) => a.name.localeCompare(b.name));
  schoolCache.places = places.length ? places : fallbackSchools;
  schoolCache.expires = Date.now() + 15 * 60 * 1000;
  return schoolCache.places;
}

const photonSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        osm_id: z.union([z.string(), z.number()]).nullish(),
        osm_type: z.string().nullish(),
        name: z.string().nullish(),
        housenumber: z.string().nullish(),
        street: z.string().nullish(),
        city: z.string().nullish(),
        state: z.string().nullish(),
        country: z.string().nullish(),
        postcode: z.string().nullish(),
      }),
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
    }),
  ),
});
export async function searchLocations(q: string, schoolsOnly: boolean) {
  const key = (schoolsOnly ? "school:" : "start:") + q.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.places;
  let places: Place[];
  if (schoolsOnly) {
    let directory: Place[];
    try {
      directory = await loadSchools();
    } catch {
      directory = schoolCache.places;
    }
    places = directory
      .filter((place) =>
        (place.name + " " + place.area).toLowerCase().includes(q.toLowerCase()),
      )
      .slice(0, 20);
  } else {
    const url = new URL(autocompleteUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "8");
    url.searchParams.set("lang", "en");
    url.searchParams.set("lat", "33.749");
    url.searchParams.set("lon", "-84.388");
    const response = await pacedFetch(url);
    if (!response.ok) throw new Error("Address search unavailable");
    places = photonSchema.parse(await response.json()).features.map((item) => {
      const address = [item.properties.housenumber, item.properties.street]
        .filter(Boolean)
        .join(" ");
      return {
        id:
          "search-" +
          (item.properties.osm_type || "place") +
          "-" +
          (item.properties.osm_id || item.geometry.coordinates.join("-")),
        name:
          item.properties.name ||
          address ||
          item.properties.city ||
          "Search result",
        kind: "Map point",
        coordinate: item.geometry.coordinates,
        area: [
          address && address !== item.properties.name ? address : undefined,
          item.properties.city,
          item.properties.state,
          item.properties.postcode,
          item.properties.country,
        ]
          .filter(Boolean)
          .join(", "),
      } satisfies Place;
    });
  }
  if (searchCache.size >= 150)
    searchCache.delete(searchCache.keys().next().value!);
  searchCache.set(key, { expires: Date.now() + 30 * 60 * 1000, places });
  return places;
}

export async function reverseLocation(lat: number, lon: number) {
  const url = new URL(reverseUrl);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "18");
  const response = await pacedFetch(url);
  if (!response.ok) throw new Error("Address lookup unavailable");
  const result = z
    .object({ display_name: z.string(), name: z.string().nullish() })
    .parse(await response.json());
  return {
    name: result.name || result.display_name.split(",")[0],
    area: result.display_name,
  };
}

function decodePolyline6(encoded: string): Coordinate[] {
  const coordinates: Coordinate[] = [];
  let index = 0,
    lat = 0,
    lon = 0;
  while (index < encoded.length) {
    let byte = 0,
      shift = 0,
      result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lon / 1e6, lat / 1e6]);
  }
  return coordinates;
}

const tripSchema = z.object({
  summary: z.object({ time: z.number(), length: z.number() }),
  legs: z.array(
    z.object({
      shape: z.string(),
      maneuvers: z
        .array(
          z.object({
            instruction: z.string(),
            rough: z.boolean().optional(),
            street_names: z.array(z.string()).optional(),
          }),
        )
        .default([]),
    }),
  ),
});
const routeSchema = z.object({
  trip: tripSchema,
  alternates: z.array(z.object({ trip: tripSchema })).optional(),
});
type LiveTrip = z.infer<typeof tripSchema>;

type RouteAttributeEdge = {
  length?: number | null;
  begin_shape_index?: number | null;
  end_shape_index?: number | null;
  speed_limit?: number | "unlimited" | null;
  names?: string[] | null;
  use?: string | null;
  surface?: string | null;
  sidewalk?: "left" | "right" | "both" | "none" | null;
  road_class?: string | null;
  traffic_signal?: boolean | null;
  traffic_signal_forward?: boolean | null;
  traffic_signal_backward?: boolean | null;
  separate_sidewalk_coverage?: number;
  separate_sidewalk_gaps?: Coordinate[];
};
type SidewalkWay = { coordinates: Coordinate[]; explicit: boolean };
type TracedRoute = { edges: RouteAttributeEdge[]; coordinates: Coordinate[] };
const traceAttributesSchema = z.object({
  shape: z.string(),
  edges: z.array(
    z.object({
      length: z.number().nullish(),
      begin_shape_index: z.number().int().nonnegative().nullish(),
      end_shape_index: z.number().int().nonnegative().nullish(),
      speed_limit: z.union([z.number(), z.literal("unlimited")]).nullish(),
      names: z.array(z.string()).nullish(),
      use: z.string().nullish(),
      surface: z.string().nullish(),
      sidewalk: z.enum(["left", "right", "both", "none"]).nullish(),
      road_class: z.string().nullish(),
      traffic_signal: z.boolean().nullish(),
      traffic_signal_forward: z.boolean().nullish(),
      traffic_signal_backward: z.boolean().nullish(),
    }),
  ),
});
function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
function tripCoordinates(trip: LiveTrip) {
  return trip.legs.flatMap((leg, legIndex) => {
    const decoded = decodePolyline6(leg.shape);
    return legIndex ? decoded.slice(1) : decoded;
  });
}
function weightedAverage(
  edges: RouteAttributeEdge[],
  value: (edge: RouteAttributeEdge) => number,
) {
  const total = edges.reduce((sum, edge) => sum + (edge.length || 0), 0);
  if (!total) return 0.5;
  return (
    edges.reduce((sum, edge) => sum + (edge.length || 0) * value(edge), 0) /
    total
  );
}
const dedicatedWalkingUse =
  /^(sidewalk|footway|pedestrian|cycleway|path|steps|pedestrian_crossing)$/;
const roadLikeUse =
  /^(road|ramp|turn_channel|track|driveway|alley|parking_aisle|emergency_access|drive_through|culdesac|service_road|living_street)$/;
function hasMappedSidewalk(edge: RouteAttributeEdge) {
  return (
    edge.sidewalk === "left" ||
    edge.sidewalk === "right" ||
    edge.sidewalk === "both"
  );
}

function sidewalkCoverage(edge: RouteAttributeEdge) {
  if (dedicatedWalkingUse.test(edge.use || "") || hasMappedSidewalk(edge))
    return 1;
  if (!roadLikeUse.test(edge.use || "")) return 0;
  return clamp(edge.separate_sidewalk_coverage || 0);
}

function projectedPoint(coordinate: Coordinate, latitude: number) {
  const radians = (latitude * Math.PI) / 180;
  return [
    coordinate[0] * 111_320 * Math.cos(radians),
    coordinate[1] * 111_320,
  ] as const;
}

function pointSegmentDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
            lengthSquared,
        ),
      )
    : 0;
  return Math.hypot(
    point[0] - (start[0] + amount * dx),
    point[1] - (start[1] + amount * dy),
  );
}

function routeSegmentHasParallelSidewalk(
  start: Coordinate,
  end: Coordinate,
  sidewalks: SidewalkWay[],
) {
  const latitude = (start[1] + end[1]) / 2;
  const routeStart = projectedPoint(start, latitude);
  const routeEnd = projectedPoint(end, latitude);
  const routeVector = [
    routeEnd[0] - routeStart[0],
    routeEnd[1] - routeStart[1],
  ] as const;
  const routeLength = Math.hypot(...routeVector);
  if (routeLength < 0.5) return false;
  const midpoint = [
    (routeStart[0] + routeEnd[0]) / 2,
    (routeStart[1] + routeEnd[1]) / 2,
  ] as const;
  return sidewalks.some((way) =>
    way.coordinates.slice(1).some((coordinate, index) => {
      const walkStart = projectedPoint(way.coordinates[index], latitude);
      const walkEnd = projectedPoint(coordinate, latitude);
      const walkVector = [
        walkEnd[0] - walkStart[0],
        walkEnd[1] - walkStart[1],
      ] as const;
      const walkLength = Math.hypot(...walkVector);
      if (walkLength < 0.5) return false;
      const parallel =
        Math.abs(
          routeVector[0] * walkVector[0] + routeVector[1] * walkVector[1],
        ) /
        (routeLength * walkLength);
      const maximumAngle = way.explicit ? Math.PI / 3 : Math.PI / 4;
      const maximumDistance = way.explicit ? 32 : 20;
      return (
        parallel >= Math.cos(maximumAngle) &&
        pointSegmentDistance(midpoint, walkStart, walkEnd) <= maximumDistance
      );
    }),
  );
}

export function addSeparateSidewalkEvidence(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  sidewalks: SidewalkWay[],
) {
  return edges.map((edge, edgeIndex) => {
    if (!roadLikeUse.test(edge.use || "") || hasMappedSidewalk(edge))
      return edge;
    const begin = Math.min(coordinates.length - 1, edge.begin_shape_index ?? 0);
    const nextBegin = edges[edgeIndex + 1]?.begin_shape_index;
    const end = Math.min(
      coordinates.length - 1,
      Math.max(begin + 1, edge.end_shape_index ?? nextBegin ?? begin + 1),
    );
    let total = 0;
    let covered = 0;
    const gaps: Coordinate[] = [];
    for (let index = begin; index < end; index++) {
      const segmentStart = coordinates[index];
      const segmentEnd = coordinates[index + 1];
      const length = distance(segmentStart, segmentEnd);
      total += length;
      if (
        routeSegmentHasParallelSidewalk(segmentStart, segmentEnd, sidewalks)
      ) {
        covered += length;
      } else {
        gaps.push([
          (segmentStart[0] + segmentEnd[0]) / 2,
          (segmentStart[1] + segmentEnd[1]) / 2,
        ]);
      }
    }
    return {
      ...edge,
      separate_sidewalk_coverage: total ? covered / total : 0,
      separate_sidewalk_gaps: gaps,
    };
  });
}

export function osmAttributeFeatures(edges: RouteAttributeEdge[]) {
  const crossings = edges.filter((edge) => edge.use === "pedestrian_crossing");
  const kilometers = Math.max(
    0.25,
    edges.reduce((sum, edge) => sum + (edge.length || 0), 0),
  );
  const sidewalk = weightedAverage(edges, (edge) => {
    if (
      dedicatedWalkingUse.test(edge.use || "") ||
      roadLikeUse.test(edge.use || "")
    )
      return 1 - sidewalkCoverage(edge);
    return 0.65;
  });
  const speed = weightedAverage(edges, (edge) => {
    if (!roadLikeUse.test(edge.use || "")) return 0;
    return clamp(
      ((typeof edge.speed_limit === "number" ? edge.speed_limit : 65) - 16) /
        64,
    );
  });
  const crossingRisk = clamp(crossings.length / Math.max(2, kilometers * 5));
  return {
    sidewalk,
    crossings: crossingRisk,
    speed,
  };
}
function edgeCoordinate(
  edge: RouteAttributeEdge,
  edgeIndex: number,
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
) {
  const begin = Math.min(coordinates.length - 1, edge.begin_shape_index ?? 0);
  const nextBegin = edges[edgeIndex + 1]?.begin_shape_index;
  const end = Math.min(
    coordinates.length - 1,
    Math.max(begin, edge.end_shape_index ?? nextBegin ?? begin),
  );
  return coordinates[Math.round((begin + end) / 2)];
}

function edgeGeometry(
  edge: RouteAttributeEdge,
  edgeIndex: number,
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
) {
  const begin = Math.min(coordinates.length - 1, edge.begin_shape_index ?? 0);
  const nextBegin = edges[edgeIndex + 1]?.begin_shape_index;
  const end = Math.min(
    coordinates.length - 1,
    Math.max(begin + 1, edge.end_shape_index ?? nextBegin ?? begin + 1),
  );
  const geometry = coordinates.slice(begin, end + 1);
  return geometry.length > 1
    ? geometry
    : [coordinates[begin], coordinates[end]].filter(Boolean);
}

function edgeRoadName(edge: RouteAttributeEdge) {
  return edge.names?.find((name) => name.trim()) || "Unnamed road";
}

function closestSegmentToGap(geometry: Coordinate[], gap: Coordinate) {
  if (geometry.length < 2) return geometry;
  let best = [geometry[0], geometry[1]] as Coordinate[];
  let bestDistance = Infinity;
  for (let index = 0; index < geometry.length - 1; index++) {
    const midpoint: Coordinate = [
      (geometry[index][0] + geometry[index + 1][0]) / 2,
      (geometry[index][1] + geometry[index + 1][1]) / 2,
    ];
    const meters = distance(midpoint, gap);
    if (meters < bestDistance) {
      bestDistance = meters;
      best = [geometry[index], geometry[index + 1]];
    }
  }
  return best;
}

function sidewalkViolationDetails(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
) {
  return edges.flatMap((edge, index): RouteViolation[] => {
    if (!roadLikeUse.test(edge.use || "") || sidewalkCoverage(edge) >= 0.95)
      return [];
    const geometry = edgeGeometry(edge, index, edges, coordinates);
    const gaps = edge.separate_sidewalk_gaps?.length
      ? edge.separate_sidewalk_gaps
      : [edgeCoordinate(edge, index, edges, coordinates)].filter(
          (coordinate): coordinate is Coordinate => Boolean(coordinate),
        );
    const roadName = edgeRoadName(edge);
    return gaps.map((gap) => ({
      coordinate: gap,
      requirement: "sidewalks" as const,
      label:
        roadName === "Unnamed road"
          ? "No sidewalk"
          : "No sidewalk — " + roadName,
      roadName,
      geometry: closestSegmentToGap(geometry, gap),
    }));
  });
}

function speedViolationDetails(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  includeUnknown: boolean,
) {
  return edges.flatMap((edge, index): RouteViolation[] => {
    if (!roadLikeUse.test(edge.use || "")) return [];
    const speed = edge.speed_limit;
    if (typeof speed === "number" && speed <= 56.327) return [];
    if (typeof speed !== "number" && !includeUnknown) return [];
    const roadName = edgeRoadName(edge);
    const speedLimitMph =
      typeof speed === "number"
        ? Math.round((speed / 1.609344) * 10) / 10
        : undefined;
    return [
      {
        coordinate: edgeCoordinate(edge, index, edges, coordinates),
        requirement: "speed" as const,
        label: speedLimitMph
          ? roadName + " — " + speedLimitMph + " mph"
          : "Speed limit unavailable — " + roadName,
        roadName,
        speedLimitMph,
        geometry: edgeGeometry(edge, index, edges, coordinates),
      },
    ];
  });
}

const roadClassRanks: Record<string, number> = {
  motorway: 1,
  trunk: 2,
  primary: 3,
  secondary: 4,
  tertiary: 5,
  unclassified: 6,
  residential: 7,
  service_other: 7,
};
const fallbackAadtByClass: Record<number, number> = {
  1: 100_000,
  2: 60_000,
  3: 30_000,
  4: 15_000,
  5: 8_000,
  6: 4_000,
  7: 1_500,
};

export function trafficRiskFromAadt(aadt: number) {
  return Math.sqrt(clamp(aadt / 40_000));
}

function nearbyTrafficStations(coordinate: Coordinate, grid: TrafficGrid) {
  const [lon, lat] = coordinate;
  const x = Math.floor(lon / trafficGridCellDegrees);
  const y = Math.floor(lat / trafficGridCellDegrees);
  const stations: TrafficStation[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      stations.push(...(grid.get(x + dx + ":" + (y + dy)) || []));
  return stations;
}

export function trafficExposure(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  stations?: TrafficStation[],
) {
  const grid = stations ? buildTrafficGrid(stations) : trafficGrid;
  return weightedAverage(edges, (edge) => {
    if (dedicatedWalkingUse.test(edge.use || "")) return 0;
    if (!roadLikeUse.test(edge.use || "")) return 0.15;
    const rank = roadClassRanks[edge.road_class || ""] || 6;
    const edgeIndex = edges.indexOf(edge);
    const coordinate = edgeCoordinate(edge, edgeIndex, edges, coordinates);
    const matches = nearbyTrafficStations(coordinate, grid)
      .map((station) => ({
        station,
        meters: distance(coordinate, station.coordinate),
      }))
      .filter(
        ({ station, meters }) =>
          meters <= 650 && Math.abs(station.functionalClass - rank) <= 1,
      )
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 3);
    const measuredAadt = matches.length
      ? matches.reduce(
          (sum, match) => sum + match.station.aadt / Math.max(75, match.meters),
          0,
        ) /
        matches.reduce((sum, match) => sum + 1 / Math.max(75, match.meters), 0)
      : 0;
    const measuredRisk = trafficRiskFromAadt(measuredAadt);
    const roadClassRisk = trafficRiskFromAadt(fallbackAadtByClass[rank]);
    return Math.max(measuredRisk, roadClassRisk);
  });
}

function coordinateAtFraction(geometry: Coordinate[], fraction: number) {
  if (geometry.length === 1) return geometry[0];
  const position = fraction * (geometry.length - 1);
  const before = Math.floor(position);
  const after = Math.min(geometry.length - 1, Math.ceil(position));
  const amount = position - before;
  return [
    geometry[before][0] + (geometry[after][0] - geometry[before][0]) * amount,
    geometry[before][1] + (geometry[after][1] - geometry[before][1]) * amount,
  ] as Coordinate;
}

export function busyRoadAvoidLocations(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  start: Coordinate,
  destination: Coordinate,
) {
  const locations: Coordinate[] = [];
  for (const [index, edge] of edges.entries()) {
    const rank = roadClassRanks[edge.road_class || ""] || 6;
    const lengthMeters = (edge.length || 0) * 1000;
    if (!roadLikeUse.test(edge.use || "") || rank > 4 || lengthMeters < 60)
      continue;
    const geometry = edgeGeometry(edge, index, edges, coordinates);
    const sampleCount = Math.min(3, Math.max(1, Math.ceil(lengthMeters / 180)));
    for (let sample = 1; sample <= sampleCount; sample++) {
      const coordinate = coordinateAtFraction(
        geometry,
        sample / (sampleCount + 1),
      );
      if (
        distance(coordinate, start) <= 110 ||
        distance(coordinate, destination) <= destinationSchoolBlockRadiusMeters
      )
        continue;
      if (locations.every((existing) => distance(existing, coordinate) > 65))
        locations.push(coordinate);
    }
  }
  return spacedCoordinates(locations, 10);
}

function edgeHasTrafficLights(edge: RouteAttributeEdge | undefined) {
  return Boolean(
    edge?.traffic_signal ||
    edge?.traffic_signal_forward ||
    edge?.traffic_signal_backward,
  );
}

const destinationSchoolBlockRadiusMeters = 180;

export function applySchoolBlockSidewalkExemption(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  destination?: Coordinate,
) {
  const routeEnd = coordinates.at(-1);
  if (!destination || !routeEnd || distance(routeEnd, destination) > 80)
    return edges;
  const schoolBlockRadiusMeters = destinationSchoolBlockRadiusMeters;
  let lastRoadIndex = -1;
  for (let index = edges.length - 1; index >= 0; index--) {
    if (roadLikeUse.test(edges[index].use || "")) {
      lastRoadIndex = index;
      break;
    }
  }
  if (lastRoadIndex < 0) return edges;
  return edges.map((edge, index) => {
    if (index > lastRoadIndex || !roadLikeUse.test(edge.use || "")) return edge;
    const gaps = edge.separate_sidewalk_gaps;
    if (gaps?.length) {
      const remaining = gaps.filter(
        (gap) => distance(gap, destination) > schoolBlockRadiusMeters,
      );
      if (remaining.length === gaps.length) return edge;
      const existingCoverage = sidewalkCoverage(edge);
      const remainingUncoveredShare =
        (1 - existingCoverage) * (remaining.length / gaps.length);
      return {
        ...edge,
        separate_sidewalk_coverage: 1 - remainingUncoveredShare,
        separate_sidewalk_gaps: remaining,
      };
    }
    if (index !== lastRoadIndex) return edge;
    const begin = Math.min(
      coordinates.length - 1,
      edge.begin_shape_index ?? coordinates.length - 1,
    );
    const end = Math.min(
      coordinates.length - 1,
      Math.max(begin, edge.end_shape_index ?? coordinates.length - 1),
    );
    const touchesSchoolBlock = coordinates
      .slice(begin, end + 1)
      .some(
        (coordinate) =>
          distance(coordinate, destination) <= schoolBlockRadiusMeters,
      );
    return touchesSchoolBlock
      ? {
          ...edge,
          separate_sidewalk_coverage: 1,
          separate_sidewalk_gaps: [],
        }
      : edge;
  });
}

function isOnDestinationSchoolBlock(
  coordinate: Coordinate,
  routeCoordinates: Coordinate[],
  destination?: Coordinate,
) {
  const routeEnd = routeCoordinates.at(-1);
  return Boolean(
    destination &&
    routeEnd &&
    distance(routeEnd, destination) <= 80 &&
    distance(coordinate, destination) <= destinationSchoolBlockRadiusMeters,
  );
}

function outsideDestinationSchoolBlock<T extends { coordinate: Coordinate }>(
  details: T[],
  routeCoordinates: Coordinate[],
  destination?: Coordinate,
) {
  return details.filter(
    (detail) =>
      !isOnDestinationSchoolBlock(
        detail.coordinate,
        routeCoordinates,
        destination,
      ),
  );
}

export function auditRouteAttributes(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  destination?: Coordinate,
): AttributeAudit {
  const sidewalkAuditEdges = applySchoolBlockSidewalkExemption(
    edges,
    coordinates,
    destination,
  );
  const roadEdges = edges.filter((edge) => roadLikeUse.test(edge.use || ""));
  const crossingEdges = edges.filter(
    (edge) => edge.use === "pedestrian_crossing",
  );
  const crossings: RouteCrossing[] = [];
  let traveled = 0;
  const total = Math.max(
    0.001,
    edges.reduce((sum, edge) => sum + (edge.length || 0), 0),
  );
  for (const [edgeIndex, edge] of edges.entries()) {
    const length = edge.length || 0;
    if (edge.use === "pedestrian_crossing") {
      const ratio = Math.min(1, (traveled + length / 2) / total);
      const index =
        edge.begin_shape_index == null
          ? Math.round(ratio * Math.max(0, coordinates.length - 1))
          : Math.min(edge.begin_shape_index, coordinates.length - 1);
      const coordinate = coordinates[index];
      if (coordinate)
        crossings.push({
          coordinate,
          signalized: edges
            .slice(Math.max(0, edgeIndex - 1), edgeIndex + 2)
            .some(edgeHasTrafficLights),
          marked: true,
        });
    }
    traveled += length;
  }
  const unmarkedCrossingCoordinates: Coordinate[] = [];
  for (let index = 0; index < edges.length; index++) {
    if (
      !roadLikeUse.test(edges[index].use || "") ||
      !dedicatedWalkingUse.test(edges[index - 1]?.use || "")
    )
      continue;
    let endIndex = index;
    let crossingLength = 0;
    while (
      endIndex < edges.length &&
      roadLikeUse.test(edges[endIndex].use || "")
    ) {
      crossingLength += edges[endIndex].length || 0;
      endIndex++;
    }
    if (
      crossingLength > 0 &&
      crossingLength <= 0.08 &&
      dedicatedWalkingUse.test(edges[endIndex]?.use || "")
    ) {
      const middleIndex = Math.floor((index + endIndex - 1) / 2);
      const coordinate = edgeCoordinate(
        edges[middleIndex],
        middleIndex,
        edges,
        coordinates,
      );
      if (coordinate) {
        unmarkedCrossingCoordinates.push(coordinate);
        const crossingEdges = edges.slice(index, endIndex);
        crossings.push({
          coordinate,
          signalized: crossingEdges.some(edgeHasTrafficLights),
          marked: false,
        });
      }
    }
    index = Math.max(index, endIndex - 1);
  }
  const sidewalkEdges = sidewalkAuditEdges.filter(
    (edge) =>
      dedicatedWalkingUse.test(edge.use || "") ||
      roadLikeUse.test(edge.use || ""),
  );
  const sidewalkLength = sidewalkEdges.reduce(
    (sum, edge) => sum + (edge.length || 0),
    0,
  );
  const uncoveredSidewalkLength = sidewalkEdges.reduce(
    (sum, edge) => sum + (edge.length || 0) * (1 - sidewalkCoverage(edge)),
    0,
  );
  const speedDetails = outsideDestinationSchoolBlock(
    speedViolationDetails(edges, coordinates, true),
    coordinates,
    destination,
  );
  const speedAlertDetails = outsideDestinationSchoolBlock(
    speedViolationDetails(edges, coordinates, false),
    coordinates,
    destination,
  );
  const sidewalkDetails = outsideDestinationSchoolBlock(
    sidewalkViolationDetails(sidewalkAuditEdges, coordinates),
    coordinates,
    destination,
  );
  const missingCrosswalkCoordinates = crossings
    .filter(
      (crossing) =>
        crossing.marked !== true &&
        !isOnDestinationSchoolBlock(
          crossing.coordinate,
          coordinates,
          destination,
        ),
    )
    .map((crossing) => crossing.coordinate);
  const sidewalkPasses =
    (sidewalkEdges.length > 0 &&
      sidewalkLength > 0 &&
      uncoveredSidewalkLength <= Math.min(0.02, sidewalkLength * 0.05)) ||
    sidewalkDetails.length === 0;
  const speedPasses = speedDetails.length === 0;
  const crossingNeeded = crossings.length > 0;
  const crosswalksPass = missingCrosswalkCoordinates.length === 0;
  const crosswalkDetails: RouteViolation[] = missingCrosswalkCoordinates.map(
    (coordinate) => ({
      coordinate,
      requirement: "crosswalks",
      label: requirementFailureLabels.crosswalks,
    }),
  );
  return {
    features: osmAttributeFeatures(sidewalkAuditEdges),
    checks: {
      speed: { applicable: roadEdges.length > 0, passes: speedPasses },
      sidewalks: {
        applicable: sidewalkEdges.length > 0,
        passes: sidewalkPasses,
      },
      crosswalks: {
        applicable: crossingNeeded,
        passes: !crossingNeeded || crosswalksPass,
      },
    },
    crossings,
    violations: {
      speed: speedDetails.map((detail) => detail.coordinate),
      sidewalks: sidewalkDetails.map((detail) => detail.coordinate),
      crosswalks: missingCrosswalkCoordinates,
    },
    violationDetails: {
      speed: speedDetails,
      sidewalks: sidewalkDetails,
      crosswalks: crosswalkDetails,
    },
    alerts: [...speedAlertDetails, ...sidewalkDetails],
  };
}

function spacedCoordinates(coordinates: Coordinate[], maximum: number) {
  if (coordinates.length <= maximum) return coordinates;
  const result: Coordinate[] = [];
  for (let index = 0; index < maximum; index++)
    result.push(
      coordinates[
        Math.round((index * (coordinates.length - 1)) / (maximum - 1))
      ],
    );
  return result;
}

export function rerouteAvoidLocations(
  requirements: Requirements,
  checks: RequirementChecks,
  violations: Partial<Record<RequirementKey, Coordinate[]>>,
  routeCoordinates: Coordinate[],
  start: Coordinate,
  end: Coordinate,
  existing: Coordinate[] = [],
) {
  const failed = requirementKeys.filter(
    (key) => requirements[key] && !checks[key].passes,
  );
  let targeted = failed.flatMap((key) =>
    spacedCoordinates(violations[key] || [], 4),
  );
  if (failed.includes("crosswalks")) {
    const crossingAvoidance = spacedCoordinates(
      violations.crosswalks || [],
      3,
    ).flatMap((crossing) => {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (const [index, coordinate] of routeCoordinates.entries()) {
        const meters = distance(crossing, coordinate);
        if (meters < nearestDistance) {
          nearestDistance = meters;
          nearestIndex = index;
        }
      }
      const nearby: Coordinate[] = [crossing];
      for (const direction of [-1, 1]) {
        let walked = 0;
        for (
          let index = nearestIndex;
          index + direction >= 0 && index + direction < routeCoordinates.length;
          index += direction
        ) {
          walked += distance(
            routeCoordinates[index],
            routeCoordinates[index + direction],
          );
          if (walked >= 45) {
            nearby.push(routeCoordinates[index + direction]);
            break;
          }
        }
      }
      return nearby;
    });
    targeted = [...targeted, ...crossingAvoidance];
  }
  if (!targeted.length && failed.length) {
    const interior = routeCoordinates.filter(
      (coordinate) =>
        distance(coordinate, start) > 75 && distance(coordinate, end) > 75,
    );
    targeted = spacedCoordinates(interior, 3);
  }
  const result = [...existing];
  for (const coordinate of targeted) {
    if (distance(coordinate, start) <= 60 || distance(coordinate, end) <= 60)
      continue;
    if (result.every((candidate) => distance(candidate, coordinate) > 35))
      result.push(coordinate);
    if (result.length >= 12) break;
  }
  return result;
}

async function fetchRouteAttributes(trip: LiveTrip) {
  return fetchRouteAttributesForCoordinates(tripCoordinates(trip));
}

async function fetchRouteAttributesForCoordinates(coordinates: Coordinate[]) {
  const stride = Math.max(1, Math.ceil(coordinates.length / 350));
  const shape = coordinates.filter(
    (_, index) => index % stride === 0 || index === coordinates.length - 1,
  );
  const response = await fetch(routeAttributesUrl, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
    body: JSON.stringify({
      shape: shape.map(([lon, lat]) => ({ lat, lon })),
      costing: "pedestrian",
      shape_match: "map_snap",
      filters: {
        action: "include",
        attributes: [
          "edge.length",
          "edge.begin_shape_index",
          "edge.end_shape_index",
          "edge.speed_limit",
          "edge.names",
          "edge.sidewalk",
          "edge.road_class",
          "edge.use",
          "edge.surface",
          "edge.traffic_signal",
          "edge.traffic_signal_forward",
          "edge.traffic_signal_backward",
          "shape",
        ],
      },
    }),
  });
  if (!response.ok) throw new Error("Route attributes unavailable");
  const payload = traceAttributesSchema.parse(await response.json());
  return {
    edges: payload.edges,
    coordinates: decodePolyline6(payload.shape),
  } satisfies TracedRoute;
}

const controlPointsSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: coordinateSchema,
      }),
    }),
  ),
});
const routeDetailsCache = new Map<
  string,
  { expires: number; crossings: RouteCrossing[] }
>();
const routeCrossingEvidenceCache = new Map<
  string,
  { expires: number; crossings: RouteCrossing[] }
>();

async function fetchControlPoints(
  url: string,
  where: string,
  outFields: string,
  coordinates: Coordinate[],
) {
  const path = sampleCoordinates(coordinates, 300);
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      ...serviceHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      f: "geojson",
      where,
      outFields,
      returnGeometry: "true",
      outSR: "4326",
      geometry: JSON.stringify({
        paths: [path],
        spatialReference: { wkid: 4326 },
      }),
      geometryType: "esriGeometryPolyline",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: "45",
      units: "esriSRUnit_Meter",
      resultRecordCount: "2000",
    }),
  });
  if (!response.ok) throw new Error("Crossing-control data unavailable");
  return controlPointsSchema
    .parse(await response.json())
    .features.map((feature) => feature.geometry.coordinates);
}

export function addCrossingControls(
  crossings: RouteCrossing[],
  trafficSignals: Coordinate[],
  radiusMeters = 25,
) {
  return crossings.map((crossing) => ({
    ...crossing,
    signalized:
      crossing.signalized ||
      trafficSignals.some(
        (coordinate) =>
          distance(crossing.coordinate, coordinate) <= radiusMeters,
      ),
  }));
}

function routeDetailsCacheKey(coordinates: Coordinate[]) {
  return sampleCoordinates(coordinates, 24)
    .map(([lon, lat]) => lon.toFixed(5) + "," + lat.toFixed(5))
    .join(";");
}

export async function liveRouteDetails(coordinates: Coordinate[]) {
  const cacheKey = routeDetailsCacheKey(coordinates);
  const cached = routeDetailsCache.get(cacheKey);
  if (cached && cached.expires > Date.now())
    return { crossings: cached.crossings };

  const evidence = routeCrossingEvidenceCache.get(cacheKey);
  let routeCoordinates = coordinates;
  let baseCrossings =
    evidence?.expires && evidence.expires > Date.now()
      ? evidence.crossings
      : undefined;
  if (!baseCrossings) {
    const traced = await fetchRouteAttributesForCoordinates(coordinates);
    routeCoordinates = traced.coordinates;
    const analysis = auditRouteAttributes(traced.edges, traced.coordinates);
    const mappedCrossings = await fetchMappedCrossings([traced]).catch(
      () => [] as MappedCrossing[],
    );
    baseCrossings = mergeMappedCrossings(
      analysis.crossings,
      mappedCrossings,
      traced.coordinates,
    );
  }
  const trafficSignals = await fetchControlPoints(
    trafficSignalsDataUrl,
    "1=1",
    "OBJECTID,STREET1,STREET2",
    routeCoordinates,
  ).catch(() => [] as Coordinate[]);
  const crossings = addCrossingControls(baseCrossings, trafficSignals);
  if (routeDetailsCache.size >= 80)
    routeDetailsCache.delete(routeDetailsCache.keys().next().value!);
  routeDetailsCache.set(cacheKey, {
    expires: Date.now() + 30 * 60 * 1000,
    crossings,
  });
  return { crossings };
}

export type MappedCrossing = {
  coordinate: Coordinate;
  marked?: boolean;
  signalized: boolean;
};
const mappedCrossingsSchema = z.object({
  elements: z.array(
    z.object({
      type: z.literal("node"),
      lat: z.number(),
      lon: z.number(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

function routePointMatch(point: Coordinate, coordinates: Coordinate[]) {
  if (coordinates.length < 2) {
    const coordinate = coordinates[0];
    return {
      distance: coordinate ? distance(point, coordinate) : Infinity,
      coordinate: coordinate || point,
    };
  }
  const latitude = point[1];
  const projected = projectedPoint(point, latitude);
  let nearest = Infinity;
  let matched = coordinates[0];
  for (let index = 0; index < coordinates.length - 1; index++) {
    const start = projectedPoint(coordinates[index], latitude);
    const end = projectedPoint(coordinates[index + 1], latitude);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((projected[0] - start[0]) * dx + (projected[1] - start[1]) * dy) /
              lengthSquared,
          ),
        )
      : 0;
    const candidateDistance = Math.hypot(
      projected[0] - (start[0] + amount * dx),
      projected[1] - (start[1] + amount * dy),
    );
    if (candidateDistance < nearest) {
      nearest = candidateDistance;
      matched = [
        coordinates[index][0] +
          amount * (coordinates[index + 1][0] - coordinates[index][0]),
        coordinates[index][1] +
          amount * (coordinates[index + 1][1] - coordinates[index][1]),
      ];
    }
  }
  return { distance: nearest, coordinate: matched };
}

function routePointDistance(point: Coordinate, coordinates: Coordinate[]) {
  return routePointMatch(point, coordinates).distance;
}

export function mergeMappedCrossings(
  crossings: RouteCrossing[],
  mappedCrossings: MappedCrossing[],
  coordinates: Coordinate[],
  routeRadiusMeters = 5,
) {
  const merged = crossings.map((crossing) => ({ ...crossing }));
  for (const mapped of mappedCrossings) {
    const existing = merged.find(
      (crossing) => distance(crossing.coordinate, mapped.coordinate) <= 18,
    );
    if (existing) {
      if (mapped.marked !== undefined) existing.marked = mapped.marked;
      existing.signalized = existing.signalized || mapped.signalized;
      continue;
    }
    if (mapped.marked !== true) continue;
    const routeMatch = routePointMatch(mapped.coordinate, coordinates);
    if (routeMatch.distance > routeRadiusMeters) continue;
    merged.push({
      coordinate: routeMatch.coordinate,
      marked: true,
      signalized: mapped.signalized,
    });
  }
  return merged;
}

export function applyMappedCrossings(
  analysis: AttributeAudit,
  coordinates: Coordinate[],
  mappedCrossings: MappedCrossing[],
  destination?: Coordinate,
): AttributeAudit {
  const crossings = mergeMappedCrossings(
    analysis.crossings,
    mappedCrossings,
    coordinates,
  );
  const unmarked = crossings.filter(
    (crossing) =>
      crossing.marked !== true &&
      !isOnDestinationSchoolBlock(
        crossing.coordinate,
        coordinates,
        destination,
      ),
  );
  const kilometers = Math.max(
    0.25,
    coordinates
      .slice(1)
      .reduce(
        (sum, coordinate, index) =>
          sum + distance(coordinates[index], coordinate) / 1000,
        0,
      ),
  );
  const crosswalkDetails: RouteViolation[] = unmarked.map((crossing) => ({
    coordinate: crossing.coordinate,
    requirement: "crosswalks",
    label: requirementFailureLabels.crosswalks,
  }));
  return {
    ...analysis,
    features: {
      ...analysis.features,
      crossings: clamp(crossings.length / Math.max(2, kilometers * 5)),
    },
    crossings,
    checks: {
      ...analysis.checks,
      crosswalks: {
        applicable: crossings.length > 0,
        passes: unmarked.length === 0,
      },
    },
    violations: {
      ...analysis.violations,
      crosswalks: unmarked.map((crossing) => crossing.coordinate),
    },
    violationDetails: {
      ...analysis.violationDetails,
      crosswalks: crosswalkDetails,
    },
  };
}

async function fetchMappedCrossings(routes: TracedRoute[]) {
  const statements = routes.map((route) => {
    const line = sampleCoordinates(route.coordinates, 55)
      .map(([lon, lat]) => lat + "," + lon)
      .join(",");
    return 'node["highway"="crossing"](around:30,' + line + ");";
  });
  const query =
    "[out:json][timeout:15];(" + statements.join("") + ");out body;";
  const response = await fetch(sidewalkDataUrl, {
    method: "POST",
    signal: AbortSignal.timeout(4500),
    headers: {
      ...serviceHeaders(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error("Mapped crosswalk data unavailable");
  return mappedCrossingsSchema
    .parse(await response.json())
    .elements.map(({ lon, lat, tags }): MappedCrossing => {
      const crossing = tags?.crossing?.toLowerCase();
      const markings = tags?.["crossing:markings"]?.toLowerCase();
      const crossingRef = tags?.crossing_ref?.toLowerCase();
      const explicitlyUnmarked =
        crossing === "unmarked" ||
        crossing === "no" ||
        markings === "no" ||
        markings === "none";
      const explicitlyMarked =
        crossing === "marked" ||
        crossing === "zebra" ||
        crossing === "traffic_signals" ||
        crossing === "pelican" ||
        crossing === "toucan" ||
        crossingRef === "zebra" ||
        Boolean(markings && markings !== "no" && markings !== "none");
      return {
        coordinate: [lon, lat],
        marked: explicitlyUnmarked
          ? false
          : explicitlyMarked
            ? true
            : undefined,
        signalized:
          crossing === "traffic_signals" ||
          tags?.["crossing:signals"] === "yes",
      };
    });
}

const sidewalkWaysSchema = z.object({
  elements: z.array(
    z.object({
      type: z.literal("way"),
      tags: z
        .object({ footway: z.string().optional() })
        .passthrough()
        .optional(),
      geometry: z.array(z.object({ lat: z.number(), lon: z.number() })).min(2),
    }),
  ),
});

function sampleCoordinates(coordinates: Coordinate[], maximum: number) {
  const stride = Math.max(1, Math.ceil(coordinates.length / maximum));
  return coordinates.filter(
    (_, index) => index % stride === 0 || index === coordinates.length - 1,
  );
}

async function fetchSeparateSidewalks(routes: TracedRoute[]) {
  const statements = routes.map((route) => {
    const line = sampleCoordinates(route.coordinates, 70)
      .map(([lon, lat]) => lat + "," + lon)
      .join(",");
    return (
      'way["highway"~"^(footway|path|pedestrian|steps)$"]' +
      '["footway"!="crossing"]["access"!="private"]["foot"!="no"]' +
      "(around:32," +
      line +
      ");"
    );
  });
  const query =
    "[out:json][timeout:20];(" + statements.join("") + ");out geom;";
  const response = await fetch(sidewalkDataUrl, {
    method: "POST",
    signal: AbortSignal.timeout(5500),
    headers: {
      ...serviceHeaders(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error("Sidewalk geometry unavailable");
  return sidewalkWaysSchema
    .parse(await response.json())
    .elements.map((way) => ({
      explicit: way.tags?.footway === "sidewalk",
      coordinates: way.geometry.map(({ lon, lat }): Coordinate => [lon, lat]),
    }));
}
const atlantaSidewalkSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      geometry: z.union([
        z.object({
          type: z.literal("LineString"),
          coordinates: z.array(coordinateSchema).min(2),
        }),
        z.object({
          type: z.literal("MultiLineString"),
          coordinates: z.array(z.array(coordinateSchema).min(2)),
        }),
      ]),
    }),
  ),
  properties: z
    .object({ exceededTransferLimit: z.boolean().optional() })
    .passthrough()
    .optional(),
});

async function fetchAtlantaSidewalks(routes: TracedRoute[]) {
  const paths = routes.map((route) =>
    sampleCoordinates(route.coordinates, 300),
  );
  const sidewalks: SidewalkWay[] = [];
  for (let offset = 0; offset < 6000; offset += 2000) {
    const response = await fetch(atlantaSidewalkDataUrl, {
      method: "POST",
      signal: AbortSignal.timeout(2500),
      headers: {
        ...serviceHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        f: "geojson",
        where: "SidewalkType <> 'No SW / Ramp'",
        outFields: "SidewalkType",
        returnGeometry: "true",
        outSR: "4326",
        geometry: JSON.stringify({ paths, spatialReference: { wkid: 4326 } }),
        geometryType: "esriGeometryPolyline",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        distance: "40",
        units: "esriSRUnit_Meter",
        resultOffset: String(offset),
        resultRecordCount: "2000",
      }),
    });
    if (!response.ok) throw new Error("Atlanta sidewalk inventory unavailable");
    const payload = atlantaSidewalkSchema.parse(await response.json());
    for (const feature of payload.features) {
      const lines =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      sidewalks.push(
        ...lines.map((coordinates) => ({ coordinates, explicit: true })),
      );
    }
    if (
      !payload.properties?.exceededTransferLimit &&
      payload.features.length < 2000
    )
      break;
  }
  return sidewalks;
}

async function analyzeTrips(
  trips: LiveTrip[],
  includeSidewalkInventory: boolean,
  includeMappedCrosswalks: boolean,
  destination: Coordinate,
) {
  const key =
    (includeSidewalkInventory ? "sidewalk:" : "attributes:") +
    (includeMappedCrosswalks ? "crosswalks:" : "") +
    destination.join(",") +
    ":" +
    trips.map((trip) => trip.legs.map((leg) => leg.shape).join("|")).join("::");
  const cached = routeFeatureCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.analyses;
  const tracedResults = await Promise.allSettled(
    trips.map(fetchRouteAttributes),
  );
  const tracedRoutes = tracedResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!tracedRoutes.length) throw new Error("Route attributes unavailable");
  const sidewalkPromise = (async () => {
    if (!includeSidewalkInventory) return [] as SidewalkWay[];
    const osmFallback = new Promise<void>((resolve) => setTimeout(resolve, 650))
      .then(() => fetchSeparateSidewalks(tracedRoutes))
      .catch(() => [] as SidewalkWay[]);
    try {
      return await fetchAtlantaSidewalks(tracedRoutes);
    } catch {
      return await osmFallback;
    }
  })();
  const crossingPromise = includeMappedCrosswalks
    ? fetchMappedCrossings(tracedRoutes).catch(() => [] as MappedCrossing[])
    : Promise.resolve([] as MappedCrossing[]);
  const [separateSidewalks, mappedCrossings] = await Promise.all([
    sidewalkPromise,
    crossingPromise,
  ]);
  let tracedIndex = 0;
  const analyses = tracedResults.map((result): RouteAnalysis | undefined => {
    if (result.status === "rejected") return undefined;
    const traced = tracedRoutes[tracedIndex++];
    const edges = addSeparateSidewalkEvidence(
      traced.edges,
      traced.coordinates,
      separateSidewalks,
    );
    const audited = auditRouteAttributes(
      edges,
      traced.coordinates,
      destination,
    );
    return {
      ...applyMappedCrossings(
        audited,
        traced.coordinates,
        mappedCrossings,
        destination,
      ),
      traffic: trafficExposure(edges, traced.coordinates),
      busyRoadLocations: busyRoadAvoidLocations(
        edges,
        traced.coordinates,
        traced.coordinates[0],
        destination,
      ),
    };
  });
  if (routeFeatureCache.size >= 40)
    routeFeatureCache.delete(routeFeatureCache.keys().next().value!);
  routeFeatureCache.set(key, {
    expires: Date.now() + 30 * 60 * 1000,
    analyses,
  });
  return analyses;
}
export function scoreLiveRisk(
  features: Weights,
  traffic: number,
  weights: Weights,
  avoidBusyRoads: boolean,
) {
  const trafficWeight = avoidBusyRoads ? 22 : 4;
  const totalWeight =
    factors.reduce((sum, factor) => sum + weights[factor], 0) + trafficWeight;
  const weightedBreakdown = Object.fromEntries(
    factors.map((factor) => [
      factor,
      (features[factor] * weights[factor] * 100) / totalWeight,
    ]),
  ) as Weights;
  const breakdown = {
    ...weightedBreakdown,
    traffic: (traffic * trafficWeight * 100) / totalWeight,
  };
  const risk = Math.round(
    Object.values(breakdown).reduce(
      (sum, contribution) => sum + contribution,
      0,
    ),
  );
  return { breakdown, risk, trafficWeight, totalWeight };
}

function liveCandidate(
  trip: LiveTrip,
  index: number,
  weights: Weights,
  analysis: RouteAnalysis,
  avoidBusyRoads: boolean,
) {
  const {
    features,
    traffic,
    checks,
    crossings,
    violations,
    alerts,
    busyRoadLocations,
  } = analysis;
  const coordinates = tripCoordinates(trip);
  const meters = trip.summary.length * 1000;
  const { breakdown, risk } = scoreLiveRisk(
    features,
    traffic,
    weights,
    avoidBusyRoads,
  );
  const edge: Edge = {
    id: "live-edge-" + index,
    from: "live-start",
    to: "live-end",
    name: "OpenStreetMap pedestrian route",
    meters,
    features,
    geometry: coordinates,
    bidirectional: false,
  };
  if (routeCrossingEvidenceCache.size >= 120)
    routeCrossingEvidenceCache.delete(
      routeCrossingEvidenceCache.keys().next().value!,
    );
  routeCrossingEvidenceCache.set(routeDetailsCacheKey(coordinates), {
    expires: Date.now() + 30 * 60 * 1000,
    crossings,
  });
  const route: Route = {
    category: "Fastest",
    nodes: ["live-start", "live-end"],
    edges: [edge],
    coordinates,
    meters,
    minutes: Math.max(1, Math.ceil(trip.summary.time / 60)),
    risk,
    cost: trip.summary.time * (1 + risk / 100),
    breakdown,
    duplicate: false,
    checks,
    crossings,
    alerts,
  };
  return {
    id: String(index),
    route,
    violations,
    violationDetails: analysis.violationDetails,
    busyRoadLocations,
  };
}
type LiveCandidate = ReturnType<typeof liveCandidate>;

export class RouteNotPossibleError extends Error {
  route: Route;
  constructor(route: Route) {
    super("Route not possible.");
    this.name = "RouteNotPossibleError";
    this.route = route;
  }
}

function failedRoute(candidates: LiveCandidate[], requirements: Requirements) {
  const best = [...candidates].sort(
    (a, b) =>
      failedRequirementCount(a, requirements) -
        failedRequirementCount(b, requirements) ||
      a.route.risk - b.route.risk ||
      a.route.minutes - b.route.minutes,
  )[0];
  const center =
    best.route.coordinates[Math.floor(best.route.coordinates.length / 2)];
  const violations = requirementKeys.flatMap((requirement) => {
    if (!requirements[requirement] || best.route.checks?.[requirement].passes)
      return [];
    const details = best.violationDetails[requirement] || [];
    if (details.length) {
      const step = Math.max(1, Math.ceil(details.length / 6));
      return details.filter((_, index) => index % step === 0).slice(0, 6);
    }
    const coordinates = spacedCoordinates(
      best.violations[requirement] || [],
      6,
    );
    return (coordinates.length ? coordinates : center ? [center] : []).map(
      (coordinate) => ({
        coordinate,
        requirement,
        label: requirementFailureLabels[requirement],
      }),
    );
  });
  return { ...best.route, category: "Lower Risk" as Category, violations };
}

function selectQualifyingRoute(
  candidates: LiveCandidate[],
  requirements: Requirements,
) {
  const qualifying = candidates.filter((candidate) =>
    meetsRequirements(candidate.route, requirements),
  );
  if (!qualifying.length) return undefined;
  const safest = [...qualifying].sort(
    (a, b) => a.route.risk - b.route.risk || a.route.minutes - b.route.minutes,
  )[0];
  return [{ ...safest.route, category: "Lower Risk" as Category }];
}

function failedRequirementCount(
  candidate: LiveCandidate,
  requirements: Requirements,
) {
  return requirementKeys.filter(
    (key) => requirements[key] && !candidate.route.checks?.[key].passes,
  ).length;
}

function uniqueTrips(trips: LiveTrip[]) {
  return trips.filter(
    (trip, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.legs.map((leg) => leg.shape).join("|") ===
          trip.legs.map((leg) => leg.shape).join("|"),
      ) === index,
  );
}

export async function liveRoutes(
  start: Coordinate,
  end: Coordinate,
  requirements: Requirements,
  avoidBusyRoads = true,
) {
  const preferenceStrength =
    requirementKeys.filter((key) => requirements[key]).length /
    requirementKeys.length;
  const requestRoutes = async (
    personalized: boolean,
    avoidLocations: Coordinate[] = [],
  ) => {
    const response = await fetch(routingUrl, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({
        locations: [
          { lat: start[1], lon: start[0] },
          { lat: end[1], lon: end[0] },
        ],
        ...(avoidLocations.length
          ? {
              avoid_locations: avoidLocations.map(([lon, lat]) => ({
                lat,
                lon,
              })),
            }
          : {}),
        costing: "pedestrian",
        ...(personalized
          ? {
              costing_options: {
                pedestrian: {
                  walkway_factor: Math.max(0.2, 1 - preferenceStrength * 0.8),
                  sidewalk_factor: Math.max(0.2, 1 - preferenceStrength * 0.8),
                  alley_factor: 2 + preferenceStrength * 8,
                  driveway_factor: 5 + preferenceStrength * 12,
                },
              },
            }
          : {}),
        units: "kilometers",
        alternates: 2,
        language: "en-US",
      }),
    });
    if (!response.ok) throw new Error("Live pedestrian routing unavailable");
    const payload = routeSchema.parse(await response.json());
    return [
      payload.trip,
      ...(payload.alternates || []).map((item) => item.trip),
    ];
  };
  const batchResults = await Promise.allSettled([requestRoutes(true)]);
  const batches = batchResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!batches.length) throw new Error("Live pedestrian routing unavailable");
  const trips = uniqueTrips(batches.flat());
  const analyses = await analyzeTrips(
    trips,
    requirements.sidewalks,
    requirements.crosswalks,
    end,
  );
  const candidates = trips.flatMap((trip, index) =>
    analyses[index]
      ? [liveCandidate(trip, index, defaults, analyses[index], avoidBusyRoads)]
      : [],
  );
  if (!candidates.length) throw new Error("Route attributes unavailable");

  if (avoidBusyRoads) {
    const currentBest = [...candidates].sort(
      (a, b) =>
        a.route.risk - b.route.risk || a.route.minutes - b.route.minutes,
    )[0];
    if (currentBest.busyRoadLocations.length) {
      const busyReroute = await Promise.allSettled([
        requestRoutes(true, currentBest.busyRoadLocations),
      ]);
      const knownShapes = new Set(
        trips.map((trip) => trip.legs.map((leg) => leg.shape).join("|")),
      );
      const quieterTrips = uniqueTrips(
        busyReroute.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        ),
      ).filter(
        (trip) => !knownShapes.has(trip.legs.map((leg) => leg.shape).join("|")),
      );
      if (quieterTrips.length) {
        try {
          const quieterAnalyses = await analyzeTrips(
            quieterTrips,
            requirements.sidewalks,
            requirements.crosswalks,
            end,
          );
          candidates.push(
            ...quieterTrips.flatMap((trip, index) =>
              quieterAnalyses[index]
                ? [
                    liveCandidate(
                      trip,
                      candidates.length + index,
                      defaults,
                      quieterAnalyses[index],
                      true,
                    ),
                  ]
                : [],
            ),
          );
        } catch {}
      }
    }
  }

  let selected = selectQualifyingRoute(candidates, requirements);

  if (!selected) {
    const ranked = [...candidates].sort(
      (a, b) =>
        failedRequirementCount(a, requirements) -
          failedRequirementCount(b, requirements) ||
        a.route.risk - b.route.risk,
    );
    const avoidanceSets = ranked
      .slice(0, 3)
      .map((candidate) =>
        rerouteAvoidLocations(
          requirements,
          candidate.route.checks!,
          candidate.violations,
          candidate.route.coordinates,
          start,
          end,
        ),
      )
      .filter((locations) => locations.length)
      .filter(
        (locations, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate
                .map((coordinate) => coordinate.join(","))
                .sort()
                .join("|") ===
              locations
                .map((coordinate) => coordinate.join(","))
                .sort()
                .join("|"),
          ) === index,
      );

    const rerouteResults = await Promise.allSettled(
      avoidanceSets.map((locations) => requestRoutes(true, locations)),
    );
    const knownShapes = new Set(
      trips.map((trip) => trip.legs.map((leg) => leg.shape).join("|")),
    );
    const knownMissingCrosswalks = candidates.flatMap(
      (candidate) => candidate.violations.crosswalks || [],
    );
    const unseen = uniqueTrips(
      rerouteResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    )
      .filter(
        (trip) => !knownShapes.has(trip.legs.map((leg) => leg.shape).join("|")),
      )
      .filter((trip) => {
        const coordinates = tripCoordinates(trip);
        return knownMissingCrosswalks.every(
          (crossing) => routePointDistance(crossing, coordinates) > 12,
        );
      });
    if (unseen.length) {
      try {
        const retrySidewalkInventory =
          requirements.sidewalks &&
          candidates.every(
            (candidate) => !candidate.route.checks?.sidewalks.passes,
          );
        const newAnalyses = await analyzeTrips(
          unseen,
          retrySidewalkInventory,
          false,
          end,
        );
        candidates.push(
          ...unseen.flatMap((trip, index) =>
            newAnalyses[index]
              ? [
                  liveCandidate(
                    trip,
                    candidates.length + index,
                    defaults,
                    newAnalyses[index],
                    avoidBusyRoads,
                  ),
                ]
              : [],
          ),
        );
        selected = selectQualifyingRoute(candidates, requirements);
      } catch {}
    }
  }

  if (!selected)
    throw new RouteNotPossibleError(failedRoute(candidates, requirements));
  return selected;
}

export function liveProviders() {
  return {
    schools: new URL(directoryUrl).hostname,
    geocoding: new URL(autocompleteUrl).hostname,
    routing: new URL(routingUrl).hostname,
    routeAttributes: new URL(routeAttributesUrl).hostname,
    sidewalks: new URL(sidewalkDataUrl).hostname,
    atlantaSidewalks: new URL(atlantaSidewalkDataUrl).hostname,
    trafficSignals: new URL(trafficSignalsDataUrl).hostname,
    trafficCounts: trafficData.source + " " + trafficData.year,
  };
}
