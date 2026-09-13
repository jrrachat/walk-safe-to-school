// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { compareRoutes, defaults } from "../shared/routing";
import { demoGraph, places } from "../shared/demo";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event?: unknown) => void>(),
  sources: new Map<string, { setData: ReturnType<typeof vi.fn> }>(),
  layers: [] as { id: string; filter?: unknown }[],
  fit: vi.fn(),
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
import MapView from "../src/MapView";
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
