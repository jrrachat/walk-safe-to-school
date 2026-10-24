import { ArrowLeft } from "lucide-react";
import { defaults, trafficWeights } from "../shared/routing";

const baseWeight = Object.values(defaults).reduce(
  (sum, weight) => sum + weight,
  0,
);

type Props = { onBack: () => void };

export default function DocsPage({ onBack }: Props) {
  return (
    <section className="docs-page" aria-labelledby="docs-title">
      <div className="panel-heading">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={18} /> Back to map
        </button>
        <h1 id="docs-title">About the routes</h1>
      </div>

      <p className="docs-summary">
        Walkwise compares walking routes using mapped sidewalks, crossings,
        speed limits, and traffic. It shows the best route that meets your
        selected checks. If none does, it shows a route with warnings.
      </p>
      <p className="docs-note">
        Map data can be incomplete. Check sidewalks and crossings in person.
      </p>

      <details className="docs-disclosure">
        <summary>Data sources</summary>
        <ul className="source-list">
          <li>
            <strong>Schools</strong>
            <a
              href="https://services1.arcgis.com/AQDHTHDrZzfsFsB5/ArcGIS/rest/services/pubgis_DBO_Education_Schools/FeatureServer/0"
              target="_blank"
              rel="noreferrer"
            >
              Atlanta school directory
            </a>
          </li>
          <li>
            <strong>Streets and routes</strong>
            <span>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>
              {" / "}
              <a
                href="https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/"
                target="_blank"
                rel="noreferrer"
              >
                Valhalla
              </a>
            </span>
          </li>
          <li>
            <strong>Sidewalks and crossings</strong>
            <span>
              <a
                href="https://www.arcgis.com/home/item.html?id=b98b545b79604fdcb7598e059181ea44"
                target="_blank"
                rel="noreferrer"
              >
                Atlanta sidewalks
              </a>
              {" / "}
              <a
                href="https://dpwgis.atlantaga.gov/hostingserver/rest/services/Signalized_Intersections/FeatureServer/0"
                target="_blank"
                rel="noreferrer"
              >
                Signals
              </a>
              {" / "}
              <a
                href="https://wiki.openstreetmap.org/wiki/Overpass_API"
                target="_blank"
                rel="noreferrer"
              >
                Overpass
              </a>
            </span>
          </li>
          <li>
            <strong>Traffic</strong>
            <a
              href="https://gdottrafficdata.drakewell.com/publicmultinodemap.asp"
              target="_blank"
              rel="noreferrer"
            >
              GDOT 2025 counts
            </a>
          </li>
          <li>
            <strong>Address search</strong>
            <span>
              <a
                href="https://photon.komoot.io/"
                target="_blank"
                rel="noreferrer"
              >
                Photon
              </a>
              {" · "}
              <a href="https://nominatim.org/" target="_blank" rel="noreferrer">
                Nominatim
              </a>
            </span>
          </li>
        </ul>
      </details>

      <details className="docs-disclosure">
        <summary>Scoring details</summary>
        <div className="scoring-note">
          <p>
            For each candidate route <var>p</var>, sidewalk gaps <var>S</var>,
            crossing exposure <var>C</var>, speed exposure <var>V</var>, and
            traffic <var>T</var> are each scaled from 0 to 1. Its risk score is
            from 0 to 100; lower is better.
          </p>
          <div className="scoring-math" aria-label="Route risk formula">
            <div>
              N(p) = {defaults.sidewalk}S(p) + {defaults.crossings}C(p)
            </div>
            <div className="math-indent">+ {defaults.speed}V(p) + wT(p)</div>
            <div>R(p) = round(100 × N(p) / ({baseWeight} + w))</div>
            <div>
              w = {trafficWeights.preferred} if avoiding busier roads; otherwise{" "}
              {trafficWeights.relaxed}
            </div>
          </div>
          <p>
            The weights were chosen by testing route scenarios. Traffic uses
            2025 GDOT counts where available and road type elsewhere.
          </p>
          <div className="scoring-math" aria-label="Route selection formula">
            <div>U(p) = number of selected checks that fail</div>
            <div>p* = arg min (U(p), R(p), t(p), d(p))</div>
          </div>
          <p>
            Compare the four values from left to right: unmet checks, risk,
            walking time <var>t</var>, then distance <var>d</var>. A fixed
            coordinate order breaks exact ties. The displayed route stays fixed
            until you change the starting point, destination, or preferences.
          </p>
        </div>
      </details>
    </section>
  );
}
