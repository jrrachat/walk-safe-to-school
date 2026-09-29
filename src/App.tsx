import { ArrowLeft, Check, Footprints, Info, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView";
import BottomSheet, { type SheetState } from "./BottomSheet";
import DestinationPanel from "./DestinationPanel";
import PlaceSearch from "./PlaceSearch";
import type { Map as RouteMap } from "maplibre-gl";
import { downloadRoute, type ExportFormat } from "./lib/routeExport";
import {
  schools as places,
  demoStart,
  isAtlantaSchool,
} from "../shared/schools";
import { demoGraph, type Place } from "../shared/demo";
import {
  defaultRequirements,
  requiredRoutes,
  requirementSchema,
  type Requirements,
  type Route,
} from "../shared/routing";
type SavedPlace = Place & {
  visibility: "private";
  label: string;
  isHome?: boolean;
};
type Trip = {
  started: number;
  route: Route;
  destination: Place;
};
const requirementDefaultsVersion = "all-checked-v2";
const initialRequirements = () => {
  try {
    if (
      localStorage.getItem("walkwise-requirements-version") !==
      requirementDefaultsVersion
    )
      return defaultRequirements;
    const parsed = requirementSchema.safeParse(
      JSON.parse(localStorage.getItem("walkwise-requirements") || "null"),
    );
    return parsed.success ? parsed.data : defaultRequirements;
  } catch {
    return defaultRequirements;
  }
};
const initialAvoidBusyRoads = () => {
  try {
    return localStorage.getItem("walkwise-avoid-busy-roads") !== "false";
  } catch {
    return true;
  }
};
const readSavedHome = (): SavedPlace | undefined => {
  try {
    const value = JSON.parse(localStorage.getItem("walkwise-home") || "null");
    if (
      !value ||
      typeof value.area !== "string" ||
      !Array.isArray(value.coordinate) ||
      value.coordinate.length !== 2 ||
      !value.coordinate.every((coordinate: unknown) =>
        Number.isFinite(coordinate),
      )
    )
      return undefined;
    return {
      id: "home",
      name: "Home",
      label: "Home",
      kind: "Home",
      area: value.area,
      coordinate: value.coordinate,
      visibility: "private",
      isHome: true,
    };
  } catch {
    return undefined;
  }
};
export default function App() {
  const exportMap = useRef<RouteMap | null>(null);
  const [exporting, setExporting] = useState(false);
  const [hasDestination, setHasDestination] = useState(false);
  const [hasStart, setHasStart] = useState(false);
  const [sheet, setSheet] = useState<SheetState>("half");
  const [mapPlace, setMapPlace] = useState<Place | null>(null);
  const explicitStart = useRef(false);
  const [homeCandidate, setHomeCandidate] = useState<Place | null>(null);
  const [tab, setTab] = useState<"explore" | "docs">("explore");
  const [modal, setModal] = useState<"home" | null>(null);
  const [start, setStart] = useState<Place>(demoStart);
  const [end, setEnd] = useState<Place>(places[0]);
  const [requirements, setRequirements] =
    useState<Requirements>(initialRequirements);
  const [avoidBusyRoads, setAvoidBusyRoads] = useState(initialAvoidBusyRoads);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeError, setRouteError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>(() => {
    const home = readSavedHome();
    return home ? [home] : [];
  });
  const [trip, setTrip] = useState<Trip | null>(null);
  const [now, setNow] = useState(Date.now());
  const selected = routes[0];
  const mapRoutes = useMemo(() => (selected ? [selected] : []), [selected]);
  const home = saved.find((place) => place.isHome);
  useEffect(() => {
    try {
      if (
        localStorage.getItem("walkwise-requirements-version") !==
        requirementDefaultsVersion
      )
        setRequirements(defaultRequirements);
    } catch {
      /* Browser storage may be unavailable. */
    }
  }, []);
  useEffect(() => {
    if (home && !trip && !explicitStart.current) {
      setStart({ ...home, name: "Home" });
      setHasStart(true);
    }
  }, [home?.id]);
  useEffect(() => {
    if (!modal) return;
    const overflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [modal]);
  useEffect(() => {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  function selectDestination(place: Place) {
    if (!isAtlantaSchool(place)) {
      setNotice("Choose an Atlanta school as your destination.");
      return;
    }
    if (trip) {
      setNotice("End your walk before changing the route.");
      return;
    }
    setEnd(place);
    setHasDestination(true);
    setMapPlace(null);
    setTab("explore");
    setSheet("half");
  }
  function selectStart(place: Place) {
    explicitStart.current = true;
    setStart(place);
    setHasStart(true);
  }
  async function currentStart() {
    if (!navigator.geolocation)
      throw new Error("Location is unavailable. Choose a starting point.");
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        resolve,
        () =>
          reject(
            new Error(
              "Location access is unavailable. Choose a starting point.",
            ),
          ),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      ),
    );
    selectStart({
      id: "current-location",
      name: "Current location",
      kind: "Map point",
      area: "Atlanta",
      coordinate: [position.coords.longitude, position.coords.latitude],
    });
  }
  useEffect(() => {
    let active = true;
    if (navigator.permissions && navigator.geolocation)
      navigator.permissions
        .query({ name: "geolocation" })
        .then((permission) => {
          if (permission.state === "granted")
            navigator.geolocation.getCurrentPosition(
              (position) => {
                if (active && !explicitStart.current)
                  setStart({
                    id: "current-location",
                    name: "Current location",
                    kind: "Map point",
                    area: "Atlanta",
                    coordinate: [
                      position.coords.longitude,
                      position.coords.latitude,
                    ],
                  });
                setHasStart(true);
              },
              () => {},
              { maximumAge: 60000, timeout: 10000 },
            );
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "walkwise-requirements",
        JSON.stringify(requirements),
      );
      localStorage.setItem(
        "walkwise-requirements-version",
        requirementDefaultsVersion,
      );
    } catch {
      /* Browser storage may be unavailable. */
    }
  }, [requirements]);
  useEffect(() => {
    try {
      localStorage.setItem("walkwise-avoid-busy-roads", String(avoidBusyRoads));
    } catch {
      /* Browser storage may be unavailable. */
    }
  }, [avoidBusyRoads]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!trip) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [trip?.started]);
  useEffect(() => {
    if (!hasDestination || !hasStart) {
      setRoutes([]);
      setLoading(false);
      setRouteError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setRouteError("");
    setRoutes([]);
    const addCrossingDetails = (route: Route) => {
      void fetch("/api/route-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: route.coordinates }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const details = await response.json();
          setRoutes((current) =>
            current.map((candidate, index) =>
              index === 0 && candidate.coordinates === route.coordinates
                ? { ...candidate, crossings: details.crossings }
                : candidate,
            ),
          );
        })
        .catch(() => {});
    };
    const run = async () => {
      try {
        const requestRoute = () =>
          fetch("/api/routes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              start: start.coordinate,
              end: end.coordinate,
              requirements,
              avoidBusyRoads,
            }),
            signal: controller.signal,
          });
        let response = await requestRoute();
        if (response.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          response = await requestRoute();
        }
        if (!response.headers.get("content-type")?.includes("application/json"))
          throw new Error("API_OFFLINE");
        const data = await response.json();
        if (!response.ok) {
          setRoutes(data.route ? [data.route] : []);
          setRouteError(data.error);
          return;
        }
        setRoutes(data.routes);
        if (data.routes[0]) addCrossingDetails(data.routes[0]);
      } catch (e) {
        if (controller.signal.aborted) return;
        try {
          setRoutes(
            requiredRoutes(
              demoGraph,
              start.coordinate,
              end.coordinate,
              requirements,
            ),
          );
        } catch (error) {
          setRouteError((error as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const timer = window.setTimeout(() => void run(), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [start, end, requirements, avoidBusyRoads, hasDestination, hasStart]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportRoute(format: ExportFormat) {
    if (exporting || !selected || loading || routeError) return;
    setExporting(true);
    try {
      if (!exportMap.current)
        throw new Error("Wait for the map to load, then try again.");
      await downloadRoute(format, exportMap.current, selected, start, end);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not download the route. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }
  function openHome() {
    setHomeCandidate(home || null);
    setModal("home");
  }
  async function saveHome() {
    if (!homeCandidate)
      throw new Error("Enter and choose your home address first.");
    const place: SavedPlace = {
      ...homeCandidate,
      id: "home",
      name: "Home",
      label: "Home",
      kind: "Home",
      area: homeCandidate.area,
      visibility: "private",
      isHome: true,
    };
    localStorage.setItem(
      "walkwise-home",
      JSON.stringify({
        area: place.area,
        coordinate: place.coordinate,
      }),
    );
    setSaved((current) => [
      ...current.filter((savedPlace) => !savedPlace.isHome),
      place,
    ]);
    selectStart(place);
    setModal(null);
    setTab("explore");
    setNotice("Home saved on this device.");
  }
  function clearHome() {
    localStorage.removeItem("walkwise-home");
    setSaved((current) => current.filter((place) => !place.isHome));
    setHomeCandidate(null);
    if (start.kind === "Home") setHasStart(false);
    setModal(null);
    setNotice("Saved Home removed from this device.");
  }
  async function endWalk(arrived: boolean) {
    setTrip(null);
    setNotice(arrived ? "Arrival confirmed." : "Walk ended.");
  }
  return (
    <div className="app-shell">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("explore");
          }}
        >
          <span className="brand-icon">
            <Footprints size={32} strokeWidth={2} aria-hidden="true" />
          </span>
          <span>Walkwise</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            aria-label="Data and API documentation"
            className={tab === "docs" ? "active" : ""}
            onClick={() => {
              setTab("docs");
              setSheet("expanded");
            }}
          >
            <Info size={18} />
            <span>Docs</span>
          </button>
        </nav>
      </header>
      <main
        data-tab={tab}
        data-sheet={sheet}
        data-routing={hasDestination && hasStart}
      >
        <BottomSheet state={sheet} onChange={setSheet}>
          {tab === "explore" && (
            <DestinationPanel
              start={start}
              end={end}
              hasDestination={hasDestination}
              hasStart={hasStart}
              routes={routes}
              requirements={requirements}
              avoidBusyRoads={avoidBusyRoads}
              loading={loading}
              exporting={exporting}
              onExport={exportRoute}
              error={routeError}
              home={home}
              walking={!!trip || exporting}
              tripContent={
                <>
                  {" "}
                  {trip && (
                    <div className="active-trip">
                      <span className="eyebrow">SAMPLE WALK IN PROGRESS</span>
                      <h3>To {trip.destination.name}</h3>
                      <p>
                        Estimated arrival{" "}
                        {new Date(
                          trip.started + trip.route.minutes * 60000,
                        ).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <progress
                        max={100}
                        value={Math.min(
                          100,
                          ((now - trip.started) /
                            (trip.route.minutes * 60000)) *
                            100,
                        )}
                      />
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => action(() => endWalk(true))}
                      >
                        <Check size={18} />
                        Confirm arrival
                      </button>
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => action(() => endWalk(false))}
                      >
                        End walk
                      </button>
                    </div>
                  )}
                </>
              }
              onStart={selectStart}
              onDestination={selectDestination}
              onLocate={() => action(currentStart)}
              onHome={openHome}
              onRequirements={setRequirements}
              onAvoidBusyRoads={setAvoidBusyRoads}
            />
          )}
          {tab === "docs" && (
            <section className="docs-page" aria-labelledby="docs-title">
              <div className="panel-heading">
                <button
                  className="back-button"
                  onClick={() => {
                    setTab("explore");
                    setSheet("half");
                  }}
                >
                  <ArrowLeft size={18} />
                  Back to map
                </button>
                <h1 id="docs-title">Data & APIs</h1>
              </div>
              <details className="docs-disclosure">
                <summary>Routing algorithm</summary>
                <div className="algorithm-docs">
                  <h2>Routing algorithm</h2>
                  <strong>
                    Bidirectional A* with traffic and road-class exposure
                  </strong>
                  <ol>
                    <li>Valhalla generates pedestrian route candidates.</li>
                    <li>
                      Scores sidewalks, crossings, speed, 2025 GDOT traffic, and
                      OpenStreetMap road class.
                    </li>
                    <li>Avoids failed areas in one parallel reroute.</li>
                    <li>
                      “Avoid busier roads” adds a search around yellow main
                      roads.
                    </li>
                    <li>
                      The lowest-risk passing route wins. If none passes, the
                      best walkable route is shown with warnings.
                    </li>
                  </ol>
                  <h2>Variables</h2>
                  <div className="variable-list">
                    <div>
                      <code>M</code>
                      <span>Missing-sidewalk exposure</span>
                      <b>weight 9</b>
                    </div>
                    <div>
                      <code>C</code>
                      <span>Crossing exposure</span>
                      <b>weight 7</b>
                    </div>
                    <div>
                      <code>V</code>
                      <span>Vehicle-speed exposure</span>
                      <b>weight 6</b>
                    </div>
                    <div>
                      <code>T</code>
                      <span>Traffic and busier-road exposure</span>
                      <b>weight 22 when enabled</b>
                    </div>
                  </div>
                  <code className="algorithm-formula">
                    R = 100 &times; (9M + 7C + 6V + wT) / (22 + w)
                  </code>
                  <p className="traffic-method">
                    T = max(&#8730;(AADT / 40,000), road-class estimate), capped
                    at 1. The traffic weight w is 22 when enabled and 4
                    otherwise.
                  </p>
                  <div className="requirement-variables">
                    <p>
                      <code>avoidBusyRoads</code>
                      Avoids yellow main roads and prefers lower traffic.
                    </p>
                    <p>
                      <code>requirements.speed</code>
                      Requires mapped roads to be 35 mph or less.
                    </p>
                    <p>
                      <code>requirements.crosswalks</code>
                      Requires a mapped crosswalk at each road crossing.
                    </p>
                    <p>
                      <code>requirements.sidewalks</code>
                      Requires sidewalks or walking-only paths.
                    </p>
                    <p>Checks ignore the final 180 meters around the school.</p>
                  </div>
                </div>
              </details>
              <details className="docs-disclosure">
                <summary>External data</summary>
                <h2 className="spaced">External data</h2>
                <div className="api-list">
                  <a
                    className="api-row"
                    href="https://services1.arcgis.com/AQDHTHDrZzfsFsB5/ArcGIS/rest/services/pubgis_DBO_Education_Schools/FeatureServer/0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Atlanta ArcGIS school directory</strong>
                    <span>School details and locations</span>
                    <code>Education_Schools / FeatureServer / 0</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://gdottrafficdata.drakewell.com/publicmultinodemap.asp"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>GDOT TADA traffic counts</strong>
                    <span>2025 daily traffic counts</span>
                    <code>Traffic_Tabular.zip / AADT_2025</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://photon.komoot.io/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Photon</strong>
                    <span>Address autocomplete</span>
                    <code>photon.komoot.io/api</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://nominatim.org/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Nominatim</strong>
                    <span>Coordinates to addresses</span>
                    <code>nominatim.openstreetmap.org/reverse</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Valhalla route API</strong>
                    <span>Walking routes, distance, and time</span>
                    <code>valhalla1.openstreetmap.de/route</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://valhalla.github.io/valhalla/api/map-matching/api-reference/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Valhalla trace attributes</strong>
                    <span>Sidewalks, speeds, and crossings</span>
                    <code>valhalla1.openstreetmap.de/trace_attributes</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://www.arcgis.com/home/item.html?id=b98b545b79604fdcb7598e059181ea44"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Atlanta Sidewalks Inventory</strong>
                    <span>Sidewalk locations and types</span>
                    <code>services2.arcgis.com/.../Sidewalks_Inventory</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://dpwgis.atlantaga.gov/hostingserver/rest/services/Signalized_Intersections/FeatureServer/0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Atlanta Signalized Intersections</strong>
                    <span>Signalized crossings</span>
                    <code>
                      dpwgis.atlantaga.gov/.../Signalized_Intersections
                    </code>
                  </a>
                  <a
                    className="api-row"
                    href="https://wiki.openstreetmap.org/wiki/Overpass_API"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Overpass API</strong>
                    <span>Mapped sidewalks and crosswalks</span>
                    <code>overpass-api.de/api/interpreter</code>
                  </a>
                  <a
                    className="api-row"
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>OpenStreetMap</strong>
                    <span>Street data and map tiles</span>
                    <code>
                      tile.openstreetmap.org/&#123;z&#125;/&#123;x&#125;/&#123;y&#125;.png
                    </code>
                  </a>
                  <a
                    className="api-row"
                    href="https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Browser Geolocation API</strong>
                    <span>Current location, with permission</span>
                  </a>
                  <a
                    className="api-row"
                    href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>Browser Web Storage API</strong>
                    <span>Saved settings on this device</span>
                    <code>localStorage</code>
                  </a>
                </div>
              </details>
              <details className="docs-disclosure">
                <summary>Walkwise endpoints</summary>
                <h2 className="spaced">Walkwise endpoints</h2>
                <div className="endpoint-list">
                  <code>GET /api/health</code>
                  <code>GET /api/schools</code>
                  <code>GET /api/search</code>
                  <code>GET /api/reverse</code>
                  <code>POST /api/routes</code>
                  <code>POST /api/route-details</code>
                </div>
              </details>
              <p className="docs-note">
                Checks use Atlanta and OpenStreetMap sidewalks, Valhalla street
                tags, 2025 GDOT traffic, mapped speeds and crossings, and
                Atlanta signal records. Coverage may be incomplete.
              </p>
            </section>
          )}
        </BottomSheet>
        <section className="map-region" aria-label="Atlanta route map">
          <MapView
            exportMap={exportMap}
            routes={mapRoutes}
            selected={selected?.category || "Lower Risk"}
            start={start}
            showStart={hasStart}
            end={hasDestination ? end : undefined}
            onPick={(p) => {
              if (exporting) return;
              if (trip) {
                setNotice("End your walk before changing the destination.");
                return;
              }
              setMapPlace(p);
            }}
            pickedPlace={mapPlace}
            onClosePlace={() => setMapPlace(null)}
            onDirections={selectDestination}
            onStartHere={(place) => {
              selectStart(place);
              setMapPlace(null);
              setTab("explore");
            }}
            bottomInset={sheet}
          />
        </section>
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            className="icon-button"
            onClick={() => setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Set home"
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(null);
              if (e.key === "Tab") {
                const nodes = e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
                );
                const first = nodes[0],
                  last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              autoFocus
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "home" && (
              <>
                <h2>Set home address</h2>
                <p>Search for your address. Home is saved on this device.</p>
                <PlaceSearch
                  label="Home address"
                  value={homeCandidate}
                  onChoose={setHomeCandidate}
                />
                <button
                  className="primary"
                  disabled={busy || !homeCandidate}
                  onClick={() => action(saveHome)}
                >
                  Save as Home
                </button>
                {home && (
                  <button className="text-link" onClick={clearHome}>
                    Remove saved Home
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
