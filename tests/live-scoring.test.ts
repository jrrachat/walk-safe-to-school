import { describe, expect, it } from "vitest";
import {
  addSeparateSidewalkEvidence,
  addCrossingControls,
  applySchoolBlockSidewalkExemption,
  applyMappedCrossings,
  auditRouteAttributes,
  buildRouteRequest,
  busyRoadAvoidLocations,
  crossingAlternativeSearchPoints,
  osmAttributeFeatures,
  rerouteAvoidLocations,
  scoreLiveRisk,
  sidewalkCrossingWaypointSets,
  trafficExposure,
  trafficRiskFromAadt,
  mergeMappedCrossings,
  parseMappedCrossings,
} from "../server/live";
import { defaults, distance, type Coordinate } from "../shared/routing";

describe("live route attribute scoring", () => {
  it("penalizes road exposure more than a dedicated pedestrian path", () => {
    const footway = osmAttributeFeatures([
      { length: 1, use: "footway", surface: "paved_smooth" },
    ]);
    const road = osmAttributeFeatures([
      {
        length: 1,
        use: "road",
        speed_limit: 56,
        surface: "paved_smooth",
      },
    ]);

    expect(road.sidewalk).toBeGreaterThan(footway.sidewalk);
    expect(road.speed).toBeGreaterThan(footway.speed);
  });

  it("makes GDOT traffic volume a major normalized exposure", () => {
    expect(trafficRiskFromAadt(0)).toBe(0);
    expect(trafficRiskFromAadt(10_000)).toBe(0.5);
    expect(trafficRiskFromAadt(40_000)).toBe(1);
    expect(trafficRiskFromAadt(80_000)).toBe(1);

    const edges = [
      { length: 1, use: "road", road_class: "secondary", begin_shape_index: 0 },
    ];
    const coordinates: Coordinate[] = [[-84.39, 33.77]];
    const low = trafficExposure(edges, coordinates, [
      {
        id: "low",
        coordinate: [-84.39, 33.77],
        aadt: 2_000,
        functionalClass: 4,
        statisticsType: "Actual",
      },
    ]);
    const high = trafficExposure(edges, coordinates, [
      {
        id: "high",
        coordinate: [-84.39, 33.77],
        aadt: 32_000,
        functionalClass: 4,
        statisticsType: "Actual",
      },
    ]);
    expect(high).toBeGreaterThan(low * 1.3);
  });

  it("penalizes yellow major-road classes even with a low nearby count", () => {
    const coordinates: Coordinate[] = [[-84.39, 33.77]];
    const primary = trafficExposure(
      [{ length: 1, use: "road", road_class: "primary", begin_shape_index: 0 }],
      coordinates,
      [],
    );
    const residential = trafficExposure(
      [
        {
          length: 1,
          use: "road",
          road_class: "residential",
          begin_shape_index: 0,
        },
      ],
      coordinates,
      [],
    );
    expect(primary).toBeGreaterThan(residential * 3);
  });

  it("targets traveled yellow-road stretches without blocking crossings or endpoints", () => {
    const coordinates: Coordinate[] = Array.from({ length: 12 }, (_, index) => [
      -84.4 + index * 0.001,
      33.77,
    ]);
    const locations = busyRoadAvoidLocations(
      [
        {
          length: 0.7,
          use: "road",
          road_class: "primary",
          begin_shape_index: 2,
          end_shape_index: 9,
        },
        {
          length: 0.02,
          use: "road",
          road_class: "primary",
          begin_shape_index: 9,
          end_shape_index: 10,
        },
        {
          length: 0.2,
          use: "road",
          road_class: "residential",
          begin_shape_index: 0,
          end_shape_index: 2,
        },
      ],
      coordinates,
      coordinates[0],
      coordinates.at(-1)!,
    );
    expect(locations.length).toBeGreaterThan(0);
    expect(locations.length).toBeLessThanOrEqual(10);
    expect(locations.every(([longitude]) => longitude > -84.398)).toBe(true);
    expect(locations.every(([longitude]) => longitude < -84.391)).toBe(true);
  });

  it("targets high-traffic and high-speed local roads", () => {
    const coordinates: Coordinate[] = [
      [-84.4, 33.77],
      [-84.398, 33.77],
      [-84.396, 33.77],
      [-84.394, 33.77],
    ];
    const edge = {
      length: 0.55,
      use: "road",
      road_class: "residential",
      begin_shape_index: 0,
      end_shape_index: 3,
    };
    const station = {
      id: "busy-local",
      coordinate: [-84.397, 33.77] as Coordinate,
      aadt: 18_000,
      functionalClass: 6,
      statisticsType: "Actual",
    };
    expect(
      busyRoadAvoidLocations(
        [edge],
        coordinates,
        coordinates[0],
        coordinates.at(-1)!,
        [station],
      ).length,
    ).toBeGreaterThan(0);
    expect(
      busyRoadAvoidLocations(
        [{ ...edge, speed_limit: 64 }],
        coordinates,
        coordinates[0],
        coordinates.at(-1)!,
        [],
      ).length,
    ).toBeGreaterThan(0);
  });

  it("does not attach a nearby parallel-road count to the route", () => {
    const exposure = trafficExposure(
      [
        {
          length: 0.55,
          use: "road",
          road_class: "residential",
          begin_shape_index: 0,
          end_shape_index: 1,
        },
      ],
      [
        [-84.4, 33.77],
        [-84.394, 33.77],
      ],
      [
        {
          id: "parallel-road",
          coordinate: [-84.397, 33.773],
          aadt: 40_000,
          functionalClass: 6,
          statisticsType: "Actual",
        },
      ],
    );
    expect(exposure).toBeLessThan(0.3);
  });
  it("makes traffic the largest factor when avoiding busier roads", () => {
    const features = { sidewalk: 0.4, crossings: 0.4, speed: 0.4 };
    const preferred = scoreLiveRisk(features, 0.8, defaults, true);
    const relaxed = scoreLiveRisk(features, 0.8, defaults, false);
    expect(preferred.trafficWeight).toBe(22);
    expect(relaxed.trafficWeight).toBe(4);
    expect(preferred.breakdown.traffic).toBeGreaterThan(
      preferred.breakdown.sidewalk,
    );
    expect(preferred.breakdown.traffic).toBeGreaterThan(
      relaxed.breakdown.traffic * 2,
    );
  });

  it("recognizes a mapped sidewalk and signalized crossing", () => {
    const result = osmAttributeFeatures([
      {
        length: 0.5,
        use: "road",
        speed_limit: 32,
        sidewalk: "left",
      },
      {
        length: 0.01,
        use: "pedestrian_crossing",
        traffic_signal: true,
      },
    ]);

    expect(result.sidewalk).toBeLessThan(0.2);
    expect(Object.keys(result).sort()).toEqual([
      "crossings",
      "sidewalk",
      "speed",
    ]);
    expect(result.crossings).toBeGreaterThan(0);
  });

  it("uses Valhalla's sidewalk field and dedicated walking edges", () => {
    const sidewalk = auditRouteAttributes(
      [
        { length: 0.6, use: "road", sidewalk: "both" },
        { length: 0.4, use: "sidewalk" },
      ],
      [
        [-84.39, 33.77],
        [-84.38, 33.78],
      ],
    );
    const driveway = auditRouteAttributes(
      [{ length: 1, use: "driveway" }],
      [
        [-84.39, 33.77],
        [-84.38, 33.78],
      ],
    );
    expect(sidewalk.checks.sidewalks.passes).toBe(true);
    expect(driveway.checks.sidewalks.passes).toBe(false);
  });

  it("enforces speed, sidewalk, and crosswalk requirements", () => {
    const continuousSidewalk = auditRouteAttributes(
      [
        {
          length: 1,
          use: "road",
          speed_limit: 48,
          sidewalk: "left",
        },
      ],
      [
        [-84.39, 33.77],
        [-84.38, 33.78],
      ],
    );
    expect(continuousSidewalk.checks.speed.passes).toBe(true);
    expect(continuousSidewalk.checks.sidewalks.passes).toBe(true);
    expect(continuousSidewalk.checks.crosswalks.applicable).toBe(false);

    const unsafeCrossing = auditRouteAttributes(
      [
        {
          length: 1,
          use: "road",
          speed_limit: 64,
        },
        { length: 0.02, use: "pedestrian_crossing" },
      ],
      [
        [-84.39, 33.77],
        [-84.385, 33.775],
        [-84.38, 33.78],
      ],
    );
    expect(unsafeCrossing.checks.speed.passes).toBe(false);
    expect(unsafeCrossing.checks.sidewalks.passes).toBe(false);
    expect(unsafeCrossing.checks.crosswalks.passes).toBe(true);
    expect(unsafeCrossing.crossings).toHaveLength(1);
  });

  it("reports the road name and mph for roads over 35 mph", () => {
    const result = auditRouteAttributes(
      [
        {
          length: 0.2,
          use: "road",
          names: ["Monroe Drive"],
          speed_limit: 64.3738,
          sidewalk: "both",
          begin_shape_index: 0,
          end_shape_index: 1,
        },
      ],
      [
        [-84.37, 33.78],
        [-84.369, 33.781],
      ],
    );
    expect(result.alerts).toMatchObject([
      {
        requirement: "speed",
        roadName: "Monroe Drive",
        speedLimitMph: 40,
        label: "Monroe Drive — 40 mph",
      },
    ]);
  });

  it("returns route geometry for each missing-sidewalk stretch", () => {
    const result = auditRouteAttributes(
      [
        {
          length: 0.1,
          use: "road",
          names: ["Example Street"],
          sidewalk: "none",
          begin_shape_index: 0,
          end_shape_index: 1,
        },
      ],
      [
        [-84.39, 33.77],
        [-84.389, 33.77],
      ],
    );
    expect(result.alerts).toMatchObject([
      {
        requirement: "sidewalks",
        label: "No sidewalk — Example Street",
        geometry: [
          [-84.39, 33.77],
          [-84.389, 33.77],
        ],
      },
    ]);
  });

  it("does not reject a route only because a speed limit is unmapped", () => {
    const result = auditRouteAttributes(
      [{ length: 1, use: "road", sidewalk: "both" }],
      [
        [-84.39, 33.77],
        [-84.38, 33.78],
      ],
    );
    expect(result.checks.speed).toEqual({ applicable: false, passes: true });
    expect(result.features.speed).toBeGreaterThan(0.5);
  });
  it("treats unlimited speed as failing the maximum-speed requirement", () => {
    const result = auditRouteAttributes(
      [{ length: 1, use: "road", speed_limit: "unlimited", sidewalk: "both" }],
      [
        [-84.39, 33.77],
        [-84.38, 33.78],
      ],
    );
    expect(result.checks.speed.passes).toBe(false);
    expect(result.features.speed).toBeGreaterThan(0.7);
  });

  it("counts a nearby parallel sidewalk mapped as a separate way", () => {
    const coordinates: Coordinate[] = [
      [-84.39, 33.77],
      [-84.389, 33.77],
    ];
    const edges = addSeparateSidewalkEvidence(
      [
        {
          length: 0.093,
          use: "road",
          begin_shape_index: 0,
          end_shape_index: 1,
          sidewalk: "none",
        },
      ],
      coordinates,
      [
        {
          explicit: true,
          coordinates: [
            [-84.39, 33.77005],
            [-84.389, 33.77005],
          ],
        },
      ],
    );
    const result = auditRouteAttributes(edges, coordinates);
    expect(edges[0].separate_sidewalk_coverage).toBe(1);
    expect(result.checks.sidewalks.passes).toBe(true);
    expect(result.features.sidewalk).toBe(0);
  });

  it("does not count a perpendicular path as a sidewalk", () => {
    const coordinates: Coordinate[] = [
      [-84.39, 33.77],
      [-84.389, 33.77],
    ];
    const edges = addSeparateSidewalkEvidence(
      [
        {
          length: 0.093,
          use: "road",
          begin_shape_index: 0,
          end_shape_index: 1,
          sidewalk: "none",
        },
      ],
      coordinates,
      [
        {
          explicit: true,
          coordinates: [
            [-84.3895, 33.7698],
            [-84.3895, 33.7702],
          ],
        },
      ],
    );
    expect(
      auditRouteAttributes(edges, coordinates).checks.sidewalks.passes,
    ).toBe(false);
  });

  it("locates sidewalk failures on the uncovered shape segment", () => {
    const coordinates: Coordinate[] = [
      [-84.39, 33.77],
      [-84.389, 33.77],
      [-84.388, 33.77],
    ];
    const edges = addSeparateSidewalkEvidence(
      [
        {
          length: 0.2,
          use: "road",
          begin_shape_index: 0,
          end_shape_index: 2,
        },
      ],
      coordinates,
      [
        {
          explicit: true,
          coordinates: [
            [-84.39, 33.77005],
            [-84.389, 33.77005],
          ],
        },
      ],
    );
    const result = auditRouteAttributes(edges, coordinates);
    expect(result.checks.sidewalks.passes).toBe(false);
    expect(result.violations.sidewalks).toEqual([
      [(-84.389 + -84.388) / 2, 33.77],
    ]);
  });

  it("ignores only sidewalk gaps on the destination school's block", () => {
    const destination: Coordinate = [-84.388, 33.77];
    const coordinates: Coordinate[] = [
      [-84.39, 33.77],
      [-84.389, 33.77],
      destination,
    ];
    const finalBlockGap: Coordinate = [-84.3884, 33.77];
    const earlierGap: Coordinate = [-84.3905, 33.77];
    const edges = [
      {
        length: 0.1,
        use: "road",
        begin_shape_index: 0,
        end_shape_index: 1,
        separate_sidewalk_coverage: 0,
        separate_sidewalk_gaps: [earlierGap],
      },
      {
        length: 0.01,
        use: "pedestrian_crossing",
        begin_shape_index: 1,
        end_shape_index: 2,
      },
      {
        length: 0.1,
        use: "road",
        begin_shape_index: 2,
        end_shape_index: 3,
        separate_sidewalk_coverage: 0,
        separate_sidewalk_gaps: [finalBlockGap],
      },
    ];
    const adjusted = applySchoolBlockSidewalkExemption(
      edges,
      coordinates,
      destination,
    );
    expect(adjusted[2].separate_sidewalk_gaps).toEqual([]);
    expect(adjusted[0].separate_sidewalk_gaps).toEqual([earlierGap]);
    const result = auditRouteAttributes(edges, coordinates, destination);
    expect(result.checks.sidewalks.passes).toBe(false);
    expect(result.violations.sidewalks).toEqual([earlierGap]);

    const finalBlockOnly = auditRouteAttributes(
      [edges[2]],
      [coordinates[1], destination],
      destination,
    );
    expect(finalBlockOnly.checks.sidewalks.passes).toBe(true);
    expect(finalBlockOnly.violations.sidewalks).toEqual([]);
    const sameEdgeAwayFromSchool = auditRouteAttributes(
      [edges[2]],
      [coordinates[1], destination],
    );
    expect(sameEdgeAwayFromSchool.checks.sidewalks.passes).toBe(false);
  });

  it("ignores every warning on the destination school's block", () => {
    const destination: Coordinate = [-84.388, 33.77];
    const coordinates: Coordinate[] = [
      [-84.3905, 33.77],
      [-84.3892, 33.77],
      [-84.3885, 33.77],
      destination,
    ];
    const result = auditRouteAttributes(
      [
        {
          length: 0.1,
          use: "footway",
          begin_shape_index: 0,
          end_shape_index: 1,
        },
        {
          length: 0.05,
          use: "road",
          names: ["School Drive"],
          speed_limit: 64.3738,
          sidewalk: "none",
          begin_shape_index: 1,
          end_shape_index: 2,
        },
        {
          length: 0.1,
          use: "footway",
          begin_shape_index: 2,
          end_shape_index: 3,
        },
      ],
      coordinates,
      destination,
    );
    expect(result.checks.speed.passes).toBe(true);
    expect(result.checks.crosswalks.passes).toBe(true);
    expect(result.checks.sidewalks.passes).toBe(true);
    expect(result.violations.speed).toEqual([]);
    expect(result.violations.crosswalks).toEqual([]);
    expect(result.violations.sidewalks).toEqual([]);
    expect(result.alerts).toEqual([]);
  });

  it("ignores mapped unmarked-crossing warnings on the school block", () => {
    const destination: Coordinate = [-84.388, 33.77];
    const coordinates: Coordinate[] = [
      [-84.3895, 33.77],
      [-84.3885, 33.77],
      destination,
    ];
    const audited = auditRouteAttributes(
      [
        {
          length: 0.02,
          use: "pedestrian_crossing",
          begin_shape_index: 1,
          end_shape_index: 2,
        },
      ],
      coordinates,
      destination,
    );
    const mapped = applyMappedCrossings(
      audited,
      coordinates,
      [
        {
          coordinate: coordinates[1],
          marked: false,
          signalized: false,
        },
      ],
      destination,
    );
    expect(mapped.checks.crosswalks.passes).toBe(true);
    expect(mapped.violations.crosswalks).toEqual([]);
    expect(mapped.violationDetails.crosswalks).toEqual([]);
  });

  it("targets only violations from checked factors when rerouting", () => {
    const requirements = {
      speed: true,
      crosswalks: false,
      sidewalks: false,
    };
    const checks = {
      speed: { applicable: true, passes: false },
      crosswalks: { applicable: false, passes: true },
      sidewalks: { applicable: true, passes: false },
    };
    const speedViolation: Coordinate = [-84.389, 33.77];
    const sidewalkViolation: Coordinate = [-84.388, 33.77];
    const result = rerouteAvoidLocations(
      requirements,
      checks,
      { speed: [speedViolation], sidewalks: [sidewalkViolation] },
      [[-84.39, 33.77], speedViolation, sidewalkViolation, [-84.387, 33.77]],
      [-84.39, 33.77],
      [-84.387, 33.77],
    );
    expect(result).toEqual([speedViolation]);
  });

  it("blocks the approach around a missing crosswalk when rerouting", () => {
    const start: Coordinate = [-84.392, 33.77];
    const before: Coordinate = [-84.3912, 33.77];
    const crossing: Coordinate = [-84.3906, 33.77];
    const after: Coordinate = [-84.39, 33.77];
    const end: Coordinate = [-84.3892, 33.77];
    const result = rerouteAvoidLocations(
      { speed: false, crosswalks: true, sidewalks: false },
      {
        speed: { applicable: false, passes: true },
        crosswalks: { applicable: true, passes: false },
        sidewalks: { applicable: false, passes: true },
      },
      { crosswalks: [crossing] },
      [start, before, crossing, after, end],
      start,
      end,
    );
    expect(result).toContainEqual(crossing);
    expect(result).toContainEqual(before);
    expect(result).toContainEqual(after);
  });

  it("excludes only the missing-sidewalk edge so nearby crossings remain usable", () => {
    const start: Coordinate = [-84.393, 33.77];
    const gap: Coordinate = [-84.3906, 33.77];
    const end: Coordinate = [-84.3882, 33.77];
    const result = rerouteAvoidLocations(
      { speed: false, crosswalks: false, sidewalks: true },
      {
        speed: { applicable: false, passes: true },
        crosswalks: { applicable: false, passes: true },
        sidewalks: { applicable: true, passes: false },
      },
      { sidewalks: [gap] },
      [start, [-84.3918, 33.77], gap, [-84.3894, 33.77], end],
      start,
      end,
    );
    expect(result).toEqual([gap]);
  });

  it("sends unsafe route points using Valhalla's exclusion field", () => {
    const request = buildRouteRequest(
      [-84.393, 33.77],
      [-84.3882, 33.77],
      1,
      true,
      [[-84.3906, 33.77]],
    );
    expect(request).toMatchObject({
      exclude_locations: [{ lat: 33.77, lon: -84.3906 }],
      costing: "pedestrian",
      alternates: 2,
    });
    expect(request).not.toHaveProperty("avoid_locations");
  });
  it("selects both ends of a nearby crossing way for a later crossing", () => {
    const waypoints = sidewalkCrossingWaypointSets(
      [
        {
          coordinate: [-84.45, 33.66],
          geometry: [
            [-84.4502, 33.6599],
            [-84.45, 33.66],
            [-84.4498, 33.6601],
          ],
          marked: true,
          signalized: false,
        },
      ],
      [[-84.45, 33.6603]],
      [-84.451, 33.6595],
    );
    expect(waypoints).toEqual([
      [
        [-84.4502, 33.6599],
        [-84.4498, 33.6601],
      ],
    ]);
  });
  it("bounds and spaces the wider crossing search for long routes", () => {
    const gaps = Array.from(
      { length: 80 },
      (_, index): Coordinate => [-84.45 + index * 0.0002, 33.66],
    );
    const points = crossingAlternativeSearchPoints(gaps);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual(gaps[0]);
    expect(distance(points.at(-1)!, gaps.at(-1)!)).toBeLessThan(120);
    expect(
      points.every(
        (point, index) =>
          index === 0 ||
          Math.abs(point[0] - points[index - 1][0]) >= 0.001,
      ),
    ).toBe(true);
  });
  it("builds bounded via routes through both ends of a crossing way", () => {
    const request = buildRouteRequest(
      [-84.393, 33.77],
      [-84.3882, 33.77],
      1,
      true,
      [],
      [
        [-84.3907, 33.7699],
        [-84.3907, 33.7701],
      ],
    );
    expect(request.locations).toEqual([
      { lat: 33.77, lon: -84.393 },
      { lat: 33.7699, lon: -84.3907, type: "via" },
      { lat: 33.7701, lon: -84.3907, type: "via" },
      { lat: 33.77, lon: -84.3882 },
    ]);
  });
  it("adds mapped crossing lights from route attributes", () => {
    const result = auditRouteAttributes(
      [
        {
          length: 0.02,
          use: "pedestrian_crossing",
          begin_shape_index: 0,
          traffic_signal_forward: true,
        },
      ],
      [
        [-84.39, 33.77],
        [-84.3875, 33.7725],
      ],
    );
    expect(result.crossings).toMatchObject([{ signalized: true }]);
  });

  it("matches city crossing lights to route crossings", () => {
    const crossings = addCrossingControls(
      [
        { coordinate: [-84.39, 33.77], signalized: false, marked: true },
        { coordinate: [-84.385, 33.775], signalized: false, marked: true },
      ],
      [[-84.3901, 33.7701]],
    );
    expect(crossings).toMatchObject([
      { signalized: true },
      { signalized: false },
    ]);
  });

  it("accepts every mapped crosswalk color/type unless explicitly unmarked", () => {
    const crossings = parseMappedCrossings([
      {
        type: "node",
        lat: 33.77,
        lon: -84.39,
        tags: { highway: "crossing" },
      },
      {
        type: "way",
        geometry: [
          { lat: 33.7699, lon: -84.389 },
          { lat: 33.77, lon: -84.389 },
          { lat: 33.7701, lon: -84.389 },
        ],
        tags: { highway: "footway", footway: "crossing" },
      },
      {
        type: "way",
        geometry: [
          { lat: 33.77, lon: -84.3881 },
          { lat: 33.77, lon: -84.388 },
        ],
        tags: { highway: "cycleway", cycleway: "crossing" },
      },
      {
        type: "node",
        lat: 33.77,
        lon: -84.387,
        tags: { highway: "crossing", crossing: "unmarked" },
      },
    ]);
    expect(crossings).toMatchObject([
      { marked: true },
      { coordinate: [-84.389, 33.77], marked: true },
      { marked: true },
      { marked: false },
    ]);
  });
  it("marks every duplicate route crossing in the same mapped crossing cluster", () => {
    const route = [
      [-84.3905, 33.77],
      [-84.39, 33.77],
      [-84.3895, 33.77],
    ] as Coordinate[];
    const result = mergeMappedCrossings(
      [
        { coordinate: [-84.3901, 33.77], marked: false, signalized: false },
        { coordinate: [-84.3899, 33.77], marked: false, signalized: false },
      ],
      [
        {
          coordinate: [-84.39, 33.77],
          marked: true,
          signalized: false,
        },
      ],
      route,
    );
    expect(result).toHaveLength(2);
    expect(result.every((crossing) => crossing.marked)).toBe(true);
  });

  it("treats all pedestrian graph path and connection uses as walkable", () => {
    const uses = [
      "sidewalk",
      "footway",
      "pedestrian",
      "cycleway",
      "mountain_bike",
      "path",
      "steps",
      "pedestrian_crossing",
      "other",
      "egress_connection",
      "platform_connection",
      "transit_connection",
    ];
    const result = osmAttributeFeatures(
      uses.map((use) => ({ length: 1, use })),
    );
    expect(result.sidewalk).toBe(0);
    expect(result.speed).toBe(0);
  });
  it("adds mapped OSM crosswalk nodes missed by route edges", () => {
    const route: Coordinate[] = [
      [-84.39, 33.77],
      [-84.389, 33.77],
      [-84.388, 33.77],
    ];
    const merged = mergeMappedCrossings(
      [
        {
          coordinate: [-84.39, 33.77],
          signalized: false,
          marked: false,
        },
      ],
      [
        {
          coordinate: [-84.39002, 33.77],
          marked: true,
          signalized: true,
        },
        {
          coordinate: [-84.389, 33.77],
          marked: true,
          signalized: false,
        },
        {
          coordinate: [-84.38, 33.78],
          marked: true,
          signalized: false,
        },
      ],
      route,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ marked: true, signalized: true });
    expect(merged[1]).toMatchObject({
      coordinate: [-84.389, 33.77],
      marked: true,
    });
  });

  it("recognizes a long BeltLine crossing way by its route intersection", () => {
    const route: Coordinate[] = [
      [-84.37, 33.77],
      [-84.368, 33.77],
    ];
    const crossings = mergeMappedCrossings(
      [
        {
          coordinate: [-84.369, 33.77],
          marked: false,
          signalized: false,
        },
      ],
      [
        {
          coordinate: [-84.369, 33.771],
          geometry: [
            [-84.369, 33.771],
            [-84.369, 33.77],
            [-84.369, 33.769],
          ],
          marked: true,
          signalized: false,
        },
      ],
      route,
    );
    expect(crossings).toMatchObject([{ marked: true }]);
  });
  it("only adds mapped crossing markers that lie on the selected route", () => {
    const route: Coordinate[] = [
      [-84.39, 33.77],
      [-84.388, 33.77],
    ];
    const merged = mergeMappedCrossings(
      [],
      [
        {
          coordinate: [-84.389, 33.77003],
          marked: true,
          signalized: false,
        },
        {
          coordinate: [-84.3885, 33.77008],
          marked: true,
          signalized: true,
        },
      ],
      route,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].coordinate[0]).toBeCloseTo(-84.389, 6);
    expect(merged[0].coordinate[1]).toBeCloseTo(33.77, 7);
  });

  it("detects an unmarked roadway crossing between pedestrian paths", () => {
    const coordinates: Coordinate[] = [
      [-84.39, 33.77],
      [-84.3898, 33.77],
      [-84.3896, 33.77],
      [-84.3894, 33.77],
    ];
    const result = auditRouteAttributes(
      [
        {
          length: 0.02,
          use: "footway",
          begin_shape_index: 0,
          end_shape_index: 1,
        },
        { length: 0.02, use: "road", begin_shape_index: 1, end_shape_index: 2 },
        {
          length: 0.02,
          use: "footway",
          begin_shape_index: 2,
          end_shape_index: 3,
        },
      ],
      coordinates,
    );
    expect(result.checks.crosswalks.passes).toBe(false);
    expect(result.crossings).toMatchObject([
      { marked: false, signalized: false },
    ]);
    expect(result.violations.crosswalks).toHaveLength(1);
  });
});
