import { Check, Download, Footprints, Home } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Place } from "../shared/demo";
import {
  displayCrossings,
  requirementKeys,
  requirementLabels,
  type Requirements,
  type Route,
} from "../shared/routing";
import PlaceSearch from "./PlaceSearch";
import type { ExportFormat } from "./lib/routeExport";

export type PlannerSaved = Place & {
  label: string;
  visibility: "private";
  isHome?: boolean;
};

type Props = {
  start: Place;
  end: Place;
  hasDestination: boolean;
  hasStart: boolean;
  routes: Route[];
  requirements: Requirements;
  avoidBusyRoads: boolean;
  loading: boolean;
  exporting: boolean;
  onExport: (format: ExportFormat) => void;
  error: string;
  home?: PlannerSaved;
  walking: boolean;
  tripContent: ReactNode;
  onStart: (place: Place) => void;
  onDestination: (place: Place) => void;
  onLocate: () => void;
  onHome: () => void;
  onRequirements: (requirements: Requirements) => void;
  onAvoidBusyRoads: (enabled: boolean) => void;
};

export default function DestinationPanel(p: Props) {
  const [findingStart, setFindingStart] = useState(false);
  const routeReady = p.hasDestination && p.hasStart;
  const selected = p.routes[0];
  const crossings = displayCrossings(selected?.crossings || []);

  return (
    <>
      <div className="planner-title">
        <h1>Which school are you going to?</h1>
      </div>

      <div className="location-fields">
        <PlaceSearch
          label="Starting point"
          bold
          value={p.hasStart ? p.start : null}
          onOpenChange={setFindingStart}
          onChoose={p.onStart}
          onLocate={p.onLocate}
          disabled={p.walking}
        />
        {!findingStart && (
          <PlaceSearch
            label="Destination school"
            value={p.hasDestination ? p.end : null}
            onChoose={p.onDestination}
            disabled={p.walking}
            prominent
          />
        )}
      </div>

      <button
        className="home-link"
        disabled={p.walking}
        onClick={
          p.home ? () => p.onStart({ ...p.home!, name: "Home" }) : p.onHome
        }
      >
        <Home size={17} />
        {p.home ? "From home" : "Set home"}
      </button>

      {routeReady && (
        <>
          <div className="route-heading">
            <h2>Walking route</h2>
          </div>
          {p.loading && (
            <p role="status" className="loading-routes">
              Finding the safest walking route...
            </p>
          )}
          {p.error && (
            <div className="route-error" role="status">
              <strong>{p.error}</strong>
            </div>
          )}
          {selected && !p.error && !p.loading && (
            <div className="route-list">
              <div className="route-card selected safest-card">
                <div className="route-top">
                  <strong>Safest route</strong>
                  <span className="route-radio">
                    <Check size={12} />
                  </span>
                </div>
                <div
                  className="route-downloads"
                  aria-label="Download route with compass"
                >
                  <p>Take the route with you, compass included.</p>
                  <div>
                    <button
                      disabled={p.exporting}
                      onClick={() => p.onExport("png")}
                    >
                      <Download size={16} aria-hidden="true" /> Download PNG
                    </button>
                    <button
                      disabled={p.exporting}
                      onClick={() => p.onExport("pdf")}
                    >
                      <Download size={16} aria-hidden="true" /> Download PDF
                    </button>
                  </div>
                  {p.exporting && (
                    <p role="status">Preparing your route map...</p>
                  )}
                </div>
                <div className="route-stats">
                  <span>
                    <b>{selected.minutes}</b> min
                  </span>
                  <span>{(selected.meters / 1609.344).toFixed(2)} mi</span>
                  <span>{crossings.length} crossings</span>
                </div>
              </div>
            </div>
          )}

          <section className="route-factors" aria-label="Route factors">
            <div className="route-factors-heading">
              <h3>Route factors</h3>
            </div>
            <div className="factor-list">
              <label className="factor-check">
                <input
                  type="checkbox"
                  disabled={p.walking}
                  checked={p.avoidBusyRoads}
                  onChange={(event) => p.onAvoidBusyRoads(event.target.checked)}
                />
                <span>
                  <strong>Avoid busier roads</strong>
                </span>
              </label>
              {requirementKeys.map((key) => (
                <label className="factor-check" key={key}>
                  <input
                    type="checkbox"
                    disabled={p.walking}
                    checked={p.requirements[key]}
                    onChange={(event) =>
                      p.onRequirements({
                        ...p.requirements,
                        [key]: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong>{requirementLabels[key]}</strong>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {selected && !p.error && (
            <details className="map-key" open>
              <summary>Map key</summary>
              <div className="map-key-items">
                <span>
                  <img
                    src="/map-key/route.png"
                    alt=""
                    className="map-key-image"
                  />
                  Route (blue)
                </span>
                <span>
                  <img
                    src="/map-key/sidewalk.png"
                    alt=""
                    className="map-key-image"
                  />
                  Sidewalk (red dashed)
                </span>
                <span>
                  <img
                    src="/map-key/local.png"
                    alt=""
                    className="map-key-image"
                  />
                  Less busy road (white)
                </span>
                <span>
                  <img
                    src="/map-key/busy.png"
                    alt=""
                    className="map-key-image"
                  />
                  Busier road (yellow)
                </span>
                <span>
                  <span className="map-key-walking marked">
                    <Footprints aria-hidden="true" strokeWidth={2.4} />
                  </span>
                  Crossing symbol
                </span>
                <span>
                  <span className="map-key-walking signalized">
                    <Footprints aria-hidden="true" strokeWidth={2.4} />
                  </span>
                  Crossing symbol (crossing lights)
                </span>
                <span>
                  <span className="map-key-warning-strip" aria-hidden="true" />
                  Suspected no crossing markings
                </span>
              </div>
            </details>
          )}

          {p.tripContent}
        </>
      )}
    </>
  );
}
