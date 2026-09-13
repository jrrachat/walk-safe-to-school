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
const stopSignsDataUrl =
  process.env.STOP_SIGNS_DATA_URL ||
  "https://dpwgis.atlantaga.gov/hostingserver/rest/services/Hosted/SIGNs_Inventory_2018/FeatureServer/0/query";
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
};
type RouteAnalysis = AttributeAudit & { traffic: number };
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
  use?: string | null;
  surface?: string | null;
  sidewalk?: "left" | "right" | "both" | "none" | null;
  road_class?: string | null;
  traffic_signal?: boolean | null;
  traffic_signal_forward?: boolean | null;
  traffic_signal_backward?: boolean | null;
  stop_sign_forward?: boolean | null;
  stop_sign_backward?: boolean | null;
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
      use: z.string().nullish(),
      surface: z.string().nullish(),
      sidewalk: z.enum(["left", "right", "both", "none"]).nullish(),
      road_class: z.string().nullish(),
      traffic_signal: z.boolean().nullish(),
      traffic_signal_forward: z.boolean().nullish(),
      traffic_signal_backward: z.boolean().nullish(),
      stop_sign_forward: z.boolean().nullish(),
      stop_sign_backward: z.boolean().nullish(),
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
    const aadt = matches.length
      ? matches.reduce(
          (sum, match) => sum + match.station.aadt / Math.max(75, match.meters),
          0,
        ) /
        matches.reduce((sum, match) => sum + 1 / Math.max(75, match.meters), 0)
      : fallbackAadtByClass[rank];
    return trafficRiskFromAadt(aadt);
  });
}

function edgeHasTrafficLights(edge: RouteAttributeEdge | undefined) {
  return Boolean(
    edge?.traffic_signal ||
    edge?.traffic_signal_forward ||
    edge?.traffic_signal_backward,
  );
}

function edgeHasStopSign(edge: RouteAttributeEdge | undefined) {
  return Boolean(edge?.stop_sign_forward || edge?.stop_sign_backward);
}

export function applySchoolBlockSidewalkExemption(
  edges: RouteAttributeEdge[],
  coordinates: Coordinate[],
  destination?: Coordinate,
) {
  const routeEnd = coordinates.at(-1);
  if (!destination || !routeEnd || distance(routeEnd, destination) > 80)
    return edges;
  const schoolBlockRadiusMeters = 180;
  let lastRoadIndex = -1;
  for (let index = edges.length - 1; index >= 0; index--) {
    if (roadLikeUse.test(edges[index].use || "")) {
      lastRoadIndex = index;
      break;
    }
  }
  if (lastRoadIndex < 0) return edges;
  let lastCrossingIndex = -1;
  for (let index = lastRoadIndex - 1; index >= 0; index--) {
    if (edges[index].use === "pedestrian_crossing") {
      lastCrossingIndex = index;
      break;
    }
  }
  return edges.map((edge, index) => {
    if (
      index <= lastCrossingIndex ||
      index > lastRoadIndex ||
      !roadLikeUse.test(edge.use || "")
    )
      return edge;
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
          stopSign: edges
            .slice(Math.max(0, edgeIndex - 1), edgeIndex + 2)
            .some(edgeHasStopSign),
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
          stopSign: crossingEdges.some(edgeHasStopSign),
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
  const sidewalkPasses =
    sidewalkEdges.length > 0 &&
    sidewalkLength > 0 &&
    uncoveredSidewalkLength <= Math.min(0.02, sidewalkLength * 0.05);
  const speedPasses = roadEdges.every(
    (edge) =>
      typeof edge.speed_limit === "number" && edge.speed_limit <= 56.327,
  );
  const crossingNeeded =
    crossingEdges.length > 0 || unmarkedCrossingCoordinates.length > 0;
  const crosswalksPass = unmarkedCrossingCoordinates.length === 0;
  const violatingCoordinates = (
    predicate: (edge: RouteAttributeEdge) => boolean,
  ) =>
    edges.flatMap((edge, index) => {
      const coordinate = predicate(edge)
        ? edgeCoordinate(edge, index, edges, coordinates)
        : undefined;
      return coordinate ? [coordinate] : [];
    });
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
      speed: violatingCoordinates(
        (edge) =>
          roadLikeUse.test(edge.use || "") &&
          (typeof edge.speed_limit !== "number" || edge.speed_limit > 56.327),
      ),
      sidewalks: sidewalkAuditEdges.flatMap((edge, index) => {
        if (!roadLikeUse.test(edge.use || "") || sidewalkCoverage(edge) >= 0.95)
          return [];
        return edge.separate_sidewalk_gaps?.length
          ? edge.separate_sidewalk_gaps
          : [
              edgeCoordinate(edge, index, sidewalkAuditEdges, coordinates),
            ].filter((coordinate): coordinate is Coordinate =>
              Boolean(coordinate),
            );
      }),
      crosswalks: unmarkedCrossingCoordinates,
    },
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
          "edge.sidewalk",
          "edge.road_class",
          "edge.use",
          "edge.surface",
          "edge.traffic_signal",
          "edge.traffic_signal_forward",
          "edge.traffic_signal_backward",
          "edge.stop_sign_forward",
          "edge.stop_sign_backward",
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
  stopSigns: Coordinate[],
  radiusMeters = 45,
) {
  return crossings.map((crossing) => {
    const signalized =
      crossing.signalized ||
      trafficSignals.some(
        (coordinate) =>
          distance(crossing.coordinate, coordinate) <= radiusMeters,
      );
    const stopSign =
      !signalized &&
      (crossing.stopSign ||
        stopSigns.some(
          (coordinate) =>
            distance(crossing.coordinate, coordinate) <= radiusMeters,
        ));
    return { ...crossing, signalized, stopSign };
  });
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

  const traced = await fetchRouteAttributesForCoordinates(coordinates);
  const analysis = auditRouteAttributes(traced.edges, traced.coordinates);
  const [signalsResult, stopsResult] = await Promise.allSettled([
    fetchControlPoints(
      trafficSignalsDataUrl,
      "1=1",
      "OBJECTID,STREET1,STREET2",
      traced.coordinates,
    ),
    fetchControlPoints(
      stopSignsDataUrl,
      "geodata_sign_signcode = 'R1-1' AND geodata_sign_status = 'Active'",
      "objectid,geodata_sign_signcode,geodata_sign_status",
      traced.coordinates,
    ),
  ]);
  const crossings = addCrossingControls(
    analysis.crossings,
    signalsResult.status === "fulfilled" ? signalsResult.value : [],
    stopsResult.status === "fulfilled" ? stopsResult.value : [],
  );
  if (routeDetailsCache.size >= 80)
    routeDetailsCache.delete(routeDetailsCache.keys().next().value!);
  routeDetailsCache.set(cacheKey, {
    expires: Date.now() + 30 * 60 * 1000,
    crossings,
  });
  return { crossings };
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
    signal: AbortSignal.timeout(25000),
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
      signal: AbortSignal.timeout(20000),
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
  destination: Coordinate,
) {
  const key =
    (includeSidewalkInventory ? "sidewalk:" : "attributes:") +
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
  let separateSidewalks: SidewalkWay[] = [];
  if (includeSidewalkInventory) {
    try {
      separateSidewalks = await fetchAtlantaSidewalks(tracedRoutes);
    } catch {
      try {
        separateSidewalks = await fetchSeparateSidewalks(tracedRoutes);
      } catch {
        throw new Error("Sidewalk geometry unavailable");
      }
    }
  }
  let tracedIndex = 0;
  const analyses = tracedResults.map((result): RouteAnalysis | undefined => {
    if (result.status === "rejected") return undefined;
    const traced = tracedRoutes[tracedIndex++];
    const edges = addSeparateSidewalkEvidence(
      traced.edges,
      traced.coordinates,
      separateSidewalks,
    );
    return {
      ...auditRouteAttributes(edges, traced.coordinates, destination),
      traffic: trafficExposure(edges, traced.coordinates),
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
function liveCandidate(
  trip: LiveTrip,
  index: number,
  weights: Weights,
  analysis: RouteAnalysis,
) {
  const { features, traffic, checks, crossings, violations } = analysis;
  const coordinates = tripCoordinates(trip);
  const meters = trip.summary.length * 1000;
  const trafficWeight = 10;
  const totalWeight = 40;
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
  };
  return { id: String(index), route, violations };
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
      signal: AbortSignal.timeout(20000),
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
  const batchResults = await Promise.allSettled([
    requestRoutes(true),
    ...(preferenceStrength > 0.01 ? [requestRoutes(false)] : []),
  ]);
  const batches = batchResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!batches.length) throw new Error("Live pedestrian routing unavailable");
  const trips = uniqueTrips(batches.flat());
  const analyses = await analyzeTrips(trips, requirements.sidewalks, end);
  const candidates = trips.flatMap((trip, index) =>
    analyses[index]
      ? [liveCandidate(trip, index, defaults, analyses[index])]
      : [],
  );
  if (!candidates.length) throw new Error("Route attributes unavailable");
  let selected = selectQualifyingRoute(candidates, requirements);
  let avoidLocations: Coordinate[] = [];

  for (let attempt = 0; !selected && attempt < 3; attempt++) {
    const ranked = [...candidates].sort(
      (a, b) =>
        failedRequirementCount(a, requirements) -
          failedRequirementCount(b, requirements) ||
        a.route.risk - b.route.risk,
    );
    let nextAvoidLocations = avoidLocations;
    for (const candidate of ranked) {
      const proposed = rerouteAvoidLocations(
        requirements,
        candidate.route.checks!,
        candidate.violations,
        candidate.route.coordinates,
        start,
        end,
        avoidLocations,
      );
      if (proposed.length > avoidLocations.length) {
        nextAvoidLocations = proposed;
        break;
      }
    }
    if (nextAvoidLocations.length === avoidLocations.length) break;
    avoidLocations = nextAvoidLocations;

    let rerouted: LiveTrip[];
    try {
      rerouted = await requestRoutes(true, avoidLocations);
    } catch {
      break;
    }
    const knownShapes = new Set(
      trips.map((trip) => trip.legs.map((leg) => leg.shape).join("|")),
    );
    const unseen = uniqueTrips(rerouted).filter(
      (trip) => !knownShapes.has(trip.legs.map((leg) => leg.shape).join("|")),
    );
    if (!unseen.length) continue;
    trips.push(...unseen);
    let newAnalyses: (RouteAnalysis | undefined)[];
    try {
      newAnalyses = await analyzeTrips(unseen, requirements.sidewalks, end);
    } catch {
      break;
    }
    candidates.push(
      ...unseen.flatMap((trip, index) =>
        newAnalyses[index]
          ? [
              liveCandidate(
                trip,
                candidates.length + index,
                defaults,
                newAnalyses[index],
              ),
            ]
          : [],
      ),
    );
    selected = selectQualifyingRoute(candidates, requirements);
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
    stopSigns: new URL(stopSignsDataUrl).hostname,
    trafficCounts: trafficData.source + " " + trafficData.year,
  };
}
