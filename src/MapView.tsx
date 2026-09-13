import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
// Vite must bundle the separate MapLibre 6 worker, including its imports.
maplibregl.setWorkerUrl(workerUrl);
import { ArrowRight } from "lucide-react";
import { createRoot } from "react-dom/client";
import PlaceIcon from "./PlaceIcon";
import { displayCrossings, distance } from "../shared/routing";
import type { SheetState } from "./BottomSheet";
import { routePadding } from "./lib/mapLayout";
import type { FeatureCollection } from "geojson";
import type { Coordinate, Route } from "../shared/routing";
import type { Place } from "../shared/demo";
import { isAtlantaSchool } from "../shared/schools";
import { useSchools } from "./lib/useSchools";

type Props = {
  routes: Route[];
  selected: string;
  start: Place;
  showStart?: boolean;
  end?: Place;
  pickedPlace?: Place | null;
  onClosePlace?: () => void;
  onDirections?: (place: Place) => void;
  onStartHere?: (place: Place) => void;
  bottomInset?: SheetState;
  onPick: (place: Place) => void;
};
export default function MapView({
  routes,
  selected,
  start,
  showStart = true,
  end,
  onPick,
  pickedPlace = null,
  onClosePlace,
  onDirections,
  onStartHere,
  bottomInset = "half",
}: Props) {
  const places = useSchools();
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null);
  const pick = useRef(onPick);
  const known = useRef<Place[]>([]);
  const lastAutoFitKey = useRef("");
  const lastRouteDataKey = useRef("");
  known.current = places;
  pick.current = onPick;
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const currentRoute = routes.find((route) => route.category === selected);
  const routeDataKey =
    selected +
    "|" +
    routes
      .map(
        (route) =>
          route.category +
          ":" +
          route.coordinates
            .map((coordinate) => coordinate.join(","))
            .join(";") +
          ":" +
          (route.violations || [])
            .map(
              (violation) =>
                violation.requirement + "@" + violation.coordinate.join(","),
            )
            .join(";"),
      )
      .join("|");
  const fitRoute = useCallback(() => {
    const m = map.current;
    if (!m || !currentRoute || !container.current?.clientWidth) return;
    const bounds = new maplibregl.LngLatBounds();
    currentRoute.coordinates.forEach((c) => bounds.extend(c));
    bounds.extend(start.coordinate);
    if (end) bounds.extend(end.coordinate);
    m.fitBounds(bounds, {
      padding: routePadding(
        container.current.clientWidth,
        container.current.clientHeight,
        window.innerWidth > 900,
        window.innerWidth <= 900
          ? bottomInset === "collapsed"
            ? 132
            : container.current.clientHeight *
              (bottomInset === "half" ? (routes.length ? 0.54 : 0.48) : 0.84)
          : 0,
      ),
      maxZoom: 15.5,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 400,
    });
  }, [currentRoute, start, end, bottomInset]);
  useEffect(() => {
    if (!container.current) return;
    setReady(false);
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        center: [-84.3805, 33.784],
        zoom: 14.7,
        style: import.meta.env.VITE_MAP_STYLE_URL || {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
          },
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
              paint: { "raster-saturation": -0.2, "raster-opacity": 1 },
            },
          ],
        },
      });
      map.current = instance;
      // Style readiness does not wait for remote map tiles. Routes still render if tiles fail.
      instance.on("style.load", () => {
        setReady(true);
        setError("");
      });
      instance.on("error", (event) => {
        if ("sourceId" in event && event.sourceId === "osm")
          setError("Street map unavailable. Your route is still shown.");
        else setError("The map could not load. Try reloading this page.");
      });
      instance.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "bottom-right",
      );
      instance.on("click", async (e) => {
        const coordinate: Coordinate = [e.lngLat.lng, e.lngLat.lat];
        const nearby = known.current.find(
          (place) => distance(place.coordinate, coordinate) < 35,
        );
        if (nearby) {
          pick.current(nearby);
          return;
        }
        let name = "Selected location";
        let area = e.lngLat.lat.toFixed(5) + ", " + e.lngLat.lng.toFixed(5);
        try {
          const response = await fetch(
            "/api/reverse?lat=" + e.lngLat.lat + "&lon=" + e.lngLat.lng,
          );
          if (response.ok) {
            const result = await response.json();
            name = result.place.name;
            area = result.place.area;
          }
        } catch {}
        pick.current({
          id: "point-" + Date.now(),
          name,
          kind: "Map point",
          coordinate,
          area,
        });
      });
    } catch {
      setError(
        "This browser cannot display the map. Try a browser with WebGL enabled.",
      );
    }
    return () => {
      instance?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        map.current?.resize();
      });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: routes.map((route) => ({
        type: "Feature",
        properties: {
          selected: route.category === selected,
          failed: Boolean(route.violations?.length),
        },
        geometry: { type: "LineString", coordinates: route.coordinates },
      })),
    };
    const routeSource = m.getSource("walk-routes") as
      maplibregl.GeoJSONSource | undefined;
    if (routeSource) {
      if (lastRouteDataKey.current !== routeDataKey) routeSource.setData(data);
    } else {
      m.addSource("walk-routes", { type: "geojson", data });
      m.addLayer({
        id: "route-alternatives",
        type: "line",
        source: "walk-routes",
        filter: ["==", ["get", "selected"], false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#738397",
          "line-width": 4,
          "line-opacity": 0.65,
        },
      });
      m.addLayer({
        id: "route-outline",
        type: "line",
        source: "walk-routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 13 },
      });
      m.addLayer({
        id: "route-selected",
        type: "line",
        source: "walk-routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "failed"], "#c43f35", "#145cdb"],
          "line-width": 8,
        },
      });
    }
    lastRouteDataKey.current = routeDataKey;
    const endpointKey = currentRoute
      ? start.coordinate.join(",") + "|" + end?.coordinate.join(",")
      : "";
    if (endpointKey && endpointKey !== lastAutoFitKey.current) {
      lastAutoFitKey.current = endpointKey;
      fitRoute();
    }
  }, [routes, selected, ready, fitRoute, currentRoute, routeDataKey]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const markers: maplibregl.Marker[] = [],
      roots: ReturnType<typeof createRoot>[] = [];
    function addPlace(
      place: Place,
      role: "origin" | "poi",
      destinationSchool = false,
    ) {
      const element = document.createElement(role === "poi" ? "button" : "div");
      element.className =
        "place-marker " +
        role +
        (destinationSchool ? " destination-school" : "");
      const icon = document.createElement("span");
      icon.className = "place-marker-dot";
      const root = createRoot(icon);
      root.render(
        <PlaceIcon kind={place.kind} size={role === "poi" ? 16 : 20} />,
      );
      roots.push(root);
      element.append(icon);
      const label = document.createElement("span");
      label.className = "place-marker-label";
      label.textContent = destinationSchool ? "Destination school" : place.name;
      element.append(label);
      element.setAttribute(
        "aria-label",
        (role === "origin"
          ? "Start: "
          : destinationSchool
            ? "Destination school: "
            : "Select school: ") + place.name,
      );
      element.addEventListener("click", (e) => {
        e.stopPropagation();
        pick.current(place);
      });
      markers.push(
        new maplibregl.Marker({ element, anchor: "bottom", offset: [0, 4] })
          .setLngLat(place.coordinate)
          .addTo(m!),
      );
    }
    if (showStart) addPlace(start, "origin");
    const schoolPlaces = places.filter(
      (place, index, all) =>
        place.id !== start.id &&
        all.findIndex((candidate) => candidate.id === place.id) === index,
    );
    let destinationFound = false;
    schoolPlaces.forEach((place) => {
      const isDestination = Boolean(
        end &&
        (place.id === end.id || distance(place.coordinate, end.coordinate) < 5),
      );
      if (isDestination) destinationFound = true;
      addPlace(place, "poi", isDestination);
    });
    if (end && !destinationFound) addPlace(end, "poi", true);
    return () => {
      markers.forEach((marker) => marker.remove());
      queueMicrotask(() => roots.forEach((root) => root.unmount()));
    };
  }, [start, showStart, end, ready, places]);
  useEffect(() => {
    const m = map.current;
    if (
      !m ||
      !ready ||
      currentRoute?.violations?.length ||
      !currentRoute?.crossings?.length
    )
      return;
    const markers = displayCrossings(currentRoute.crossings).map(
      (crossing, index) => {
        const element = document.createElement("div");
        element.className =
          "crossing-marker" +
          (crossing.signalized
            ? " signalized"
            : crossing.stopSign
              ? " stop-sign"
              : "");
        const label = crossing.signalized
          ? "Crosswalk with lights"
          : crossing.stopSign
            ? "Crosswalk with stop sign"
            : crossing.marked === false
              ? "Road crossing"
              : "Crosswalk";
        element.textContent = label;
        element.setAttribute("aria-label", label + " " + (index + 1));
        return new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(crossing.coordinate)
          .addTo(m);
      },
    );
    return () => markers.forEach((marker) => marker.remove());
  }, [currentRoute, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !currentRoute?.violations?.length) return;
    const groups: { coordinate: Coordinate; labels: string[] }[] = [];
    for (const violation of currentRoute.violations) {
      const existing = groups.find(
        (group) => distance(group.coordinate, violation.coordinate) <= 35,
      );
      if (existing) {
        if (!existing.labels.includes(violation.label))
          existing.labels.push(violation.label);
      } else {
        groups.push({
          coordinate: violation.coordinate,
          labels: [violation.label],
        });
      }
    }
    const markers = groups.slice(0, 14).map((group, index) => {
      const element = document.createElement("div");
      element.className = "route-violation-marker";
      element.textContent = group.labels.join(" · ");
      element.setAttribute(
        "aria-label",
        "Route problem " + (index + 1) + ": " + group.labels.join(", "),
      );
      return new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat(group.coordinate)
        .addTo(m);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [currentRoute, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !pickedPlace) return;
    const node = document.createElement("div");
    const root = createRoot(node);
    root.render(
      <div className="place-popup">
        <strong>{pickedPlace.name}</strong>
        <small>{pickedPlace.area}</small>
        {isAtlantaSchool(pickedPlace) ? (
          <button
            className="popup-directions"
            onClick={() => onDirections?.(pickedPlace)}
          >
            Get Directions
            <ArrowRight size={17} />
          </button>
        ) : (
          <button
            className="popup-directions"
            onClick={() => onStartHere?.(pickedPlace)}
          >
            Use as starting point
            <ArrowRight size={17} />
          </button>
        )}
      </div>,
    );
    const popup = new maplibregl.Popup({
      anchor: "bottom",
      closeButton: true,
      closeOnClick: false,
      maxWidth: "270px",
      offset: 20,
    })
      .setLngLat(pickedPlace.coordinate)
      .setDOMContent(node)
      .addTo(m!);
    const handleClose = () => onClosePlace?.();
    popup.on("close", handleClose);
    return () => {
      popup.off("close", handleClose);
      popup.remove();
      queueMicrotask(() => root.unmount());
    };
  }, [pickedPlace, ready, onClosePlace, onDirections, onStartHere]);

  return (
    <div className="map-container">
      <div ref={container} className="map" data-route-count={routes.length} />
      {error && (
        <div className="map-error" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
