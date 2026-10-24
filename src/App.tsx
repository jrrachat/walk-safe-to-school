import { Footprints, Info, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView";
import BottomSheet, { type SheetState } from "./BottomSheet";
import DestinationPanel from "./DestinationPanel";
import DocsPage from "./DocsPage";
import PlaceSearch from "./PlaceSearch";
import type { Map as RouteMap } from "maplibre-gl";
import { downloadRoute, type ExportFormat } from "./lib/routeExport";
import {
  schools as places,
  demoStart,
  isAtlantaSchool,
} from "../shared/schools";
import type { Place } from "../shared/demo";
import {
  defaultRequirements,
  requirementSchema,
  type Requirements,
  type Route,
} from "../shared/routing";
type SavedPlace = Place & {
  visibility: "private";
  label: string;
  isHome?: boolean;
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
    if (home && !explicitStart.current) {
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
          if (controller.signal.aborted) return;
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
              fast: false,
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
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setRoutes(data.route ? [data.route] : []);
          setRouteError(data.error);
          return;
        }
        setRoutes(data.routes);
        if (data.routes[0]) addCrossingDetails(data.routes[0]);
        setLoading(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        setRoutes([]);
        setRouteError(
          "Live routing is unavailable right now. Please try again shortly.",
        );
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
          <span className="brand-name">
            Walkwise <em>Atlanta</em>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button
            aria-label="About routes and data"
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
              onStart={selectStart}
              onDestination={selectDestination}
              onLocate={() => action(currentStart)}
              onHome={openHome}
              onRequirements={setRequirements}
              onAvoidBusyRoads={setAvoidBusyRoads}
            />
          )}
          {tab === "docs" && (
            <DocsPage
              onBack={() => {
                setTab("explore");
                setSheet("half");
              }}
            />
          )}
        </BottomSheet>
        <section className="map-region" aria-label="Atlanta route map">
          {selected && (
            <div className="map-guide">
              <span className="map-guide-line" aria-hidden="true" />
              Follow the blue line <span aria-hidden="true">·</span> Tap ! for
              details
            </div>
          )}
          <MapView
            exportMap={exportMap}
            routes={mapRoutes}
            selected={selected?.category || "Lower Risk"}
            start={start}
            showStart={hasStart}
            end={hasDestination ? end : undefined}
            onPick={(p) => {
              if (exporting) return;
              if (isAtlantaSchool(p)) selectDestination(p);
              else setMapPlace(p);
            }}
            pickedPlace={mapPlace}
            onClosePlace={() => setMapPlace(null)}
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
