import { ArrowLeft } from "lucide-react";
import { defaults, trafficWeights } from "../shared/routing";

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
        <p className="scoring-note">
          Each candidate walking route gets a risk score from 0 to 100; lower is
          better. The score is a weighted average of sidewalk gaps (
          {defaults.sidewalk}), crossing exposure ({defaults.crossings}), speed
          exposure ({defaults.speed}), and traffic ({trafficWeights.preferred}{" "}
          when Avoid busier roads is on, or {trafficWeights.relaxed} when off).
          These weights were chosen by testing route scenarios. Traffic uses
          2025 GDOT counts where available and road type elsewhere. Among routes
          that pass every selected check, the lowest risk score wins. If none
          passes, the app chooses the route with the fewest unmet checks, then
          the lowest risk score. Walking time breaks ties. The displayed route
          stays fixed until you change the starting point, destination, or
          preferences.
        </p>
      </details>
    </section>
  );
}
