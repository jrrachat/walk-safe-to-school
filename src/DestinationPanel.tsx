import { Check, Download, Footprints, Home } from "lucide-react";
import { useState } from "react";
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
  const hasUnmetRequirements = Boolean(
    selected &&
    requirementKeys.some(
      (key) => p.requirements[key] && !selected.checks?.[key].passes,
    ),
  );

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
          disabled={p.exporting}
        />
        {!findingStart && (
          <PlaceSearch
            label="Destination school"
            value={p.hasDestination ? p.end : null}
            onChoose={p.onDestination}
            disabled={p.exporting}
            prominent
          />
        )}
      </div>

      <button
        className="home-link"
        disabled={p.exporting}
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
              Checking walking routes...
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
                  <strong>
                    {hasUnmetRequirements
                      ? "Best available route"
                      : "Recommended route"}
                  </strong>
                  <span className="route-radio">
                    <Check size={12} />
                  </span>
                </div>
                {hasUnmetRequirements && (
                  <small>
                    Review the map warnings where a checked preference could not
                    be confirmed.
                  </small>
                )}
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

          {selected && !p.error && (
            <details className="map-key" open>
              <summary>How to read the map</summary>
              <p className="map-key-intro">
                Follow the blue line. Colored marks show places to check along
                the walk.
              </p>
              <div className="map-key-items">
                <div>
                  <span className="map-key-line route" aria-hidden="true" />
                  <span>
                    <strong>Blue line</strong>
                    <small>Your walking route</small>
                  </span>
                </div>
                <div>
                  <span className="map-key-line sidewalk" aria-hidden="true" />
                  <span>
                    <strong>Orange dashes</strong>
                    <small>Sidewalk not mapped here</small>
                  </span>
                </div>
                <div>
                  <span className="map-key-alert sidewalk" aria-hidden="true">
                    S
                  </span>
                  <span>
                    <strong>Orange S</strong>
                    <small>Tap for sidewalk details</small>
                  </span>
                </div>
                <div>
                  <span className="map-key-walking marked" aria-hidden="true">
                    <Footprints aria-hidden="true" strokeWidth={2.4} />
                  </span>
                  <span>
                    <strong>Blue footprints</strong>
                    <small>Mapped crosswalk</small>
                  </span>
                </div>
                <div>
                  <span
                    className="map-key-walking signalized"
                    aria-hidden="true"
                  >
                    <Footprints aria-hidden="true" strokeWidth={2.4} />
                  </span>
                  <span>
                    <strong>Green footprints</strong>
                    <small>Mapped signalized crosswalk</small>
                  </span>
                </div>
                <div>
                  <span className="map-key-alert likely" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <strong>Orange warning</strong>
                    <small>Likely crossing; markings not verified</small>
                  </span>
                </div>
                <div>
                  <span className="map-key-alert" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <strong>Red warning</strong>
                    <small>Crosswalk not verified</small>
                  </span>
                </div>
              </div>
              <p className="map-key-note">
                Short red or orange bars across the route mark those same
                crossing warnings. Tap a warning for details. Street colors are
                background only.
              </p>
            </details>
          )}
          <section className="route-factors" aria-label="Route factors">
            <div className="route-factors-heading">
              <h3>Route factors</h3>
            </div>
            <div className="factor-list">
              <label className="factor-check">
                <input
                  type="checkbox"
                  disabled={p.exporting}
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
                    disabled={p.exporting}
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
        </>
      )}
    </>
  );
}
