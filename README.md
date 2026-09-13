# Walkwise Atlanta

A student-focused walking-route planner for Atlanta. The frontend uses React, Vite, TypeScript, and MapLibre. A Node/TypeScript Express API searches addresses and Atlanta schools, requests pedestrian routes, and checks mapped street attributes.

No account is required. A user's Home address and selected route factors are stored in that browser's local storage. Clearing site data removes them, and they do not sync between devices.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

The API listens on `http://127.0.0.1:3001`; Vite proxies `/api` to it. You can also run `npm run dev:web` and `npm run dev:api` separately.

```sh
npm test
npm run build
npm run test:ui
```

After a build, `npm start` serves the production frontend and API on port 3001.

## Current behavior

- The map fills most of the desktop layout and becomes full screen behind a draggable bottom sheet on phones.
- The starting point can be a searched address, current location, saved Home, or a selected map point.
- Destinations are limited to Atlanta-area schools from the live school directory.
- The app evaluates route alternatives with 2025 GDOT annual average daily traffic as its largest individual risk factor when **Avoid busier roads** is checked, then shows one safest qualifying route.
- Route crossings use compact symbols: blue for a normal crossing and green for crossing lights. A red strip marks a suspected crossing without mapped markings.
- The route panel uses the supplied map swatch images to identify the blue route, red dashed sidewalks, white less-busy roads, and yellow busier roads.
- The search fields stay visible above the route summary and route factors. Avoid busier roads and all three requirements start checked and can be changed.
- The Docs page in the app lists every live data API and explains the available mapped route attributes.

## Route selection

For every live route request, the API asks Valhalla for pedestrian candidates and alternatives, scores their GDOT traffic exposure, and selects the lowest-risk qualifying route. When a parent checks a required factor, it asks Valhalla for route candidates and alternatives, then calls Valhalla's trace-attributes endpoint to map-match each candidate to OpenStreetMap road data. It combines the Atlanta Sidewalks inventory, nearby separately mapped pedestrian ways from Overpass, and Valhalla road-side sidewalk tags so both local survey lines and OpenStreetMap sidewalk representations are counted. Crosswalk detection combines Valhalla route edges with nearby OpenStreetMap `highway=crossing` nodes and deduplicates nodes at the same intersection. All three requirements start checked. Each remains editable, and every checked requirement is mandatory. Candidates that fail are removed, and the API makes one parallel reroute pass with several targeted avoidance patterns. For a missing crosswalk, the avoided area includes the crossing and its short approaches so the router can cross on an earlier block. Retry candidates are checked against the already identified unsafe crossing locations without downloading the same crossing dataset again. It reports failure only after those alternatives are exhausted. Roads above 35 mph are labeled with their mapped road name and speed, and missing-sidewalk geometry is highlighted directly on the map. Speed, crosswalk, and sidewalk warnings within 180 meters of the destination are treated as the school's final block and ignored when the route ends at that school. Warnings farther from the school still affect requirements and trigger rerouting. **Avoid busier roads** is a preference rather than a mandatory requirement. When enabled, the API identifies traveled stretches of primary and secondary roads, asks Valhalla for another set of candidates that excludes those stretches, and substantially raises the combined GDOT traffic and OpenStreetMap road-class weight. Short segments used only to cross a main road, the first 110 meters, and the destination school's final 180 meters are not excluded, so necessary crossings and school access remain possible. Among qualifying candidates, the API returns the route with the smallest risk score, breaking ties with walking time. The risk score uses only these internal factors:

```text
route risk = 100 Ãƒâ€” (9M + 7C + 6V + wT) / (22 + w)

traffic/road-class factor = max(Ã¢Ë†Å¡(AADT / 40,000), OSM road-class estimate), capped at 1

M, C, V, and T are distance-weighted route factors.
w = 22 when Avoid busier roads is checked; w = 4 when it is unchecked.
```

When `LIVE_SERVICES=false`, the API uses the bundled development graph and weighted Dijkstra. This fallback exists for local testing and does not provide Atlanta-wide coverage.

Route checks depend on mapped OpenStreetMap attributes. Missing or outdated map data can cause a route to fail a requirement or make the result incomplete, so the interface describes the checks as mapped-data results.

## Live services

Default providers work for local development and can be replaced through environment variables:

| Purpose                       | Default provider                             | Setting                     |
| ----------------------------- | -------------------------------------------- | --------------------------- |
| Atlanta school directory      | Fulton County/Atlanta ArcGIS Feature Service | `SCHOOL_DIRECTORY_URL`      |
| Annual average daily traffic  | GDOT TADA 2025 statewide count stations      | `GDOT_TRAFFIC_DATA_PATH`    |
| Starting-address autocomplete | Photon                                       | `AUTOCOMPLETE_SEARCH_URL`   |
| Reverse geocoding             | Nominatim                                    | `GEOCODER_REVERSE_URL`      |
| Pedestrian routes             | Valhalla                                     | `ROUTING_URL`               |
| Route street attributes       | Valhalla trace attributes / OpenStreetMap    | `ROUTE_ATTRIBUTES_URL`      |
| Atlanta sidewalk inventory    | ArcGIS Feature Service                       | `ATLANTA_SIDEWALK_DATA_URL` |
| Traffic lights                | City of Atlanta Signalized Intersections     | `TRAFFIC_SIGNALS_DATA_URL`  |
| Separate sidewalk geometry    | Overpass API / OpenStreetMap                 | `SIDEWALK_DATA_URL`         |
| Map tiles                     | OpenStreetMap through MapLibre               | `VITE_MAP_STYLE_URL`        |

The API caches responses and applies upstream timeouts. Before a public launch, use contracted or self-hosted geocoding, routing, and map-tile infrastructure and review each provider's usage policy.

## Browser storage

| Key                         | Contents                         |
| --------------------------- | -------------------------------- |
| `walkwise-home`             | Home label and coordinates       |
| `walkwise-requirements`     | Selected route-factor checkboxes |
| `walkwise-avoid-busy-roads` | Avoid busier roads preference    |

No password, profile, Family membership, or live trip location is collected.

## Source layout

| Path                       | Responsibility                                                            |
| -------------------------- | ------------------------------------------------------------------------- |
| `src/App.tsx`              | Planner state, local Home persistence, saved schools, and Docs page       |
| `src/DestinationPanel.tsx` | Address/school inputs, route summary, map key, and route factors          |
| `src/MapView.tsx`          | MapLibre map, route rendering, markers, crossings, and map interaction    |
| `shared/routing.ts`        | Route schemas, risk calculation, and Dijkstra fallback                    |
| `server/live.ts`           | Live school, geocoding, routing, and OpenStreetMap attribute integrations |
| `server/index.ts`          | HTTP API and production frontend server                                   |
| `tests/`                   | Route, map, school, and local Home behavior tests                         |

MapLibre route rendering reference: [MapLibre GeoJSON line example](https://maplibre.org/maplibre-gl-js/docs/examples/geojson-line/). The default map uses OpenStreetMap tiles with visible attribution; follow the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) before scaling traffic.

The map key uses the supplied MapLibre swatch images: red dashed lines are sidewalks, white roads are less busy, yellow roads are busier, and the selected route remains blue. Route scoring uses GDOT AADT counts for measured traffic volume and applies OpenStreetMap road class as a minimum traffic estimate.

Crossing annotations match Valhalla's crossing positions to the City of Atlanta Signalized Intersections layer. They load after the route line so they do not delay ordinary directions.
