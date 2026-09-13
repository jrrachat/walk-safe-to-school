// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { compareRoutes, defaults, distance } from "../shared/routing";
import { demoGraph, places } from "../shared/demo";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event?: unknown) => void>(),
  sources: new Map<string, { setData: ReturnType<typeof vi.fn> }>(),
  layers: [] as { id: string; filter?: unknown }[],
  fit: vi.fn(),
  zoom: 14.7,
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  Map: class {
    on(name: string, callback: (event?: unknown) => void) {
      mock.handlers.set(name, callback);
    }
    addControl() {}
    remove() {}
    resize() {}
    setLayoutProperty() {}
    getSource(id: string) {
      return mock.sources.get(id);
    }
    addSource(id: string) {
      mock.sources.set(id, { setData: vi.fn() });
    }
    addLayer(layer: { id: string }) {
      mock.layers.push(layer);
    }
    fitBounds(...args: unknown[]) {
      mock.fit(...args);
    }
    getZoom() {
      return mock.zoom;
    }
    project(coordinate: [number, number]) {
      return { x: coordinate[0] * 10000, y: coordinate[1] * -10000 };
    }
    off(name: string) {
      mock.handlers.delete(name);
    }
  },
  NavigationControl: class {},
  LngLatBounds: class {
    extend() {
      return this;
    }
  },
  Marker: class {
    element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
    }
    setLngLat() {
      return this;
    }
    addTo() {
      document.body.append(this.element);
      return this;
    }
    remove() {
      this.element.remove();
    }
  },
}));
import MapView, { crossingWarningStrip } from "../src/MapView";
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  mock.handlers.clear();
  mock.sources.clear();
  mock.layers.length = 0;
  mock.fit.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("draws the selected route when the style is ready, without waiting for tiles", () => {
  const routes = compareRoutes(
    demoGraph,
    places[0].coordinate,
    places[2].coordinate,
    defaults,
  );
  render(
    <MapView
      routes={routes}
      selected="Recommended"
      start={places[0]}
      end={places[2]}
      onPick={() => {}}
    />,
  );
  expect(mock.handlers.has("load")).toBe(false);
  act(() => mock.handlers.get("style.load")?.());
  act(() => mock.handlers.get("error")?.({ sourceId: "osm" }));
  expect(screen.queryByText(/Street map unavailable/)).toBeNull();
  expect(mock.layers.map((l) => l.id)).toContain("route-selected");
  expect(mock.layers.find((l) => l.id === "route-selected")?.filter).toEqual([
    "==",
    ["get", "selected"],
    true,
  ]);
  expect(
    document.querySelector(".origin .place-marker-label")?.textContent,
  ).toBe("Midtown MARTA");
  expect(document.querySelector(".destination")).toBeNull();
  expect(
    document.querySelector(".destination-school .place-marker-label")
      ?.textContent,
  ).toBe("Destination school");
  expect(
    Array.from(document.querySelectorAll(".poi .place-marker-label")).some(
      (label) => label.textContent === "Midtown High School",
    ),
  ).toBe(false);
  expect(mock.fit).toHaveBeenCalledTimes(1);
  expect(mock.handlers.has("zoomend")).toBe(false);
  expect(mock.handlers.has("dragend")).toBe(false);
  expect(mock.fit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Show route" })).toBeNull();
});
it("does not rewrite equivalent route data during an unrelated render", () => {
  const routes = compareRoutes(
    demoGraph,
    places[0].coordinate,
    places[2].coordinate,
    defaults,
  );
  const { rerender } = render(
    <MapView
      routes={[routes[1]]}
      selected="Recommended"
      start={places[0]}
      end={places[2]}
      onPick={() => {}}
    />,
  );
  act(() => mock.handlers.get("style.load")?.());
  const source = mock.sources.get("walk-routes")!;
  expect(source.setData).toHaveBeenCalledTimes(0);
  rerender(
    <MapView
      routes={[routes[1]]}
      selected="Recommended"
      start={places[0]}
      end={places[2]}
      onPick={() => {}}
    />,
  );
  expect(source.setData).toHaveBeenCalledTimes(0);
});

it("updates route geometry after changing the selected route", () => {
  const routes = compareRoutes(
    demoGraph,
    places[0].coordinate,
    places[2].coordinate,
    defaults,
  );
  const props = {
    routes,
    start: places[0],
    end: places[2],
    onPick: () => {},
  };
  const { rerender } = render(<MapView {...props} selected="Recommended" />);
  act(() => mock.handlers.get("style.load")?.());
  rerender(<MapView {...props} selected="Lower Risk" />);
  const data = mock.sources.get("walk-routes")!.setData.mock.lastCall![0];
  expect(
    data.features.filter(
      (f: { properties: { selected: boolean } }) => f.properties.selected,
    )[0].geometry.coordinates,
  ).toEqual(routes[2].coordinates);
});

it("draws a short warning strip perpendicular to the walking route", () => {
  const strip = crossingWarningStrip(
    [-84.389, 33.77],
    [
      [-84.39, 33.77],
      [-84.388, 33.77],
    ],
  );
  expect(strip).toHaveLength(2);
  expect(strip[0][0]).toBeCloseTo(strip[1][0], 7);
  expect(distance(strip[0], strip[1])).toBeCloseTo(14, 0);
});

it("draws sidewalk stretches and points speed warnings at the road", () => {
  const routes = compareRoutes(
    demoGraph,
    places[0].coordinate,
    places[2].coordinate,
    defaults,
  );
  const route = {
    ...routes[1],
    crossings: [
      {
        coordinate: routes[1].coordinates[1],
        signalized: true,
        marked: true,
      },
      {
        coordinate: routes[1].coordinates[2],
        signalized: false,
        marked: false,
      },
    ],
    violations: [
      {
        coordinate: routes[1].coordinates[2],
        requirement: "sidewalks" as const,
        label: "Sidewalk missing",
      },
      {
        coordinate: routes[1].coordinates[2],
        requirement: "crosswalks" as const,
        label: "Crosswalk missing",
      },
    ],
    alerts: [
      {
        coordinate: routes[1].coordinates[1],
        requirement: "speed" as const,
        label: "Monroe Drive ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â 40 mph",
        roadName: "Monroe Drive",
        speedLimitMph: 40,
        geometry: routes[1].coordinates.slice(0, 2),
      },
      {
        coordinate: routes[1].coordinates[2],
        requirement: "sidewalks" as const,
        label:
          "No sidewalk ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Example Street",
        geometry: routes[1].coordinates.slice(1, 3),
      },
    ],
  };
  render(
    <MapView
      routes={[route]}
      selected={route.category}
      start={places[0]}
      end={places[2]}
      onPick={() => {}}
    />,
  );
  act(() => mock.handlers.get("style.load")?.());
  expect(mock.layers.map((layer) => layer.id)).toContain(
    "sidewalk-warning-stretches",
  );
  expect(mock.layers.map((layer) => layer.id)).toContain(
    "suspected-unmarked-crossings",
  );
  expect(document.querySelectorAll(".crossing-marker")).toHaveLength(1);
  expect(document.querySelector(".crosswalk-warning")).toBeNull();
  expect(document.querySelector(".speed-warning-road")?.textContent).toBe(
    "Monroe Drive",
  );
  expect(document.querySelector(".speed-warning-limit")?.textContent).toBe(
    "40 mph",
  );
  const walkingMarker = document.querySelector<HTMLElement>(".crossing-marker");
  expect(walkingMarker?.textContent).toBe("");
  expect(walkingMarker?.querySelector("svg")).not.toBeNull();
  expect(walkingMarker?.getAttribute("aria-label")).toContain(
    "Crossing symbol (crossing lights)",
  );
  expect(
    Number.parseInt(
      walkingMarker?.style
        .getPropertyValue("--crossing-marker-size")
        .replace("px", "") || "22",
    ),
  ).toBeLessThanOrEqual(22);
  expect(document.querySelector(".sidewalk-warning")?.textContent).toContain(
    "No sidewalk ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Example Street",
  );
});
