import { describe, expect, it } from "vitest";
import {
  addSeparateSidewalkEvidence,
  addCrossingControls,
  applySchoolBlockSidewalkExemption,
  auditRouteAttributes,
  osmAttributeFeatures,
  rerouteAvoidLocations,
  trafficExposure,
  trafficRiskFromAadt,
} from "../server/live";
import type { Coordinate } from "../shared/routing";

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
    expect(high).toBeGreaterThan(low * 3);
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
    const earlierGap: Coordinate = [-84.3895, 33.77];
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

  it("adds mapped lights and stop signs to crossings", () => {
    const result = auditRouteAttributes(
      [
        {
          length: 0.02,
          use: "pedestrian_crossing",
          begin_shape_index: 0,
          traffic_signal_forward: true,
        },
        {
          length: 0.02,
          use: "pedestrian_crossing",
          begin_shape_index: 2,
          stop_sign_backward: true,
        },
      ],
      [
        [-84.39, 33.77],
        [-84.3875, 33.7725],
        [-84.385, 33.775],
      ],
    );
    expect(result.crossings[0]).toMatchObject({ signalized: true });
    expect(result.crossings[1]).toMatchObject({ stopSign: true });
  });

  it("matches city traffic lights and stop signs to route crossings", () => {
    const crossings = addCrossingControls(
      [
        { coordinate: [-84.39, 33.77], signalized: false, marked: true },
        { coordinate: [-84.385, 33.775], signalized: false, marked: true },
        { coordinate: [-84.38, 33.78], signalized: false, marked: true },
      ],
      [[-84.3901, 33.7701]],
      [
        [-84.3901, 33.7701],
        [-84.3851, 33.7751],
      ],
    );
    expect(crossings).toMatchObject([
      { signalized: true, stopSign: false },
      { signalized: false, stopSign: true },
      { signalized: false, stopSign: false },
    ]);
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
