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
- The app evaluates route alternatives with 2025 GDOT annual average daily traffic as its largest individual risk factor, then shows one safest qualifying route.
- Detected crosswalks are labeled with mapped traffic lights or stop signs.
- The search fields stay visible above the route summary, three route-factor checkboxes, and Start Walk button.
- The Docs page in the app lists every live data API and explains the available mapped route attributes.

## Route selection

For every live route request, the API asks Valhalla for pedestrian candidates and alternatives, scores their GDOT traffic exposure, and selects the lowest-risk qualifying route. When a parent checks a required factor, it asks Valhalla for route candidates and alternatives, then calls Valhalla's trace-attributes endpoint to map-match each candidate to OpenStreetMap road data. It combines the Atlanta Sidewalks inventory, nearby separately mapped pedestrian ways from Overpass, and Valhalla road-side sidewalk tags so both local survey lines and OpenStreetMap sidewalk representations are counted. Each checked factor is required. Candidates that fail are removed, and the API makes up to three additional targeted route requests that avoid the failing road or crossing locations. It reports failure only after those alternatives are exhausted. Missing-sidewalk gaps within 180 meters of the destination are ignored only on the final school block; sidewalk gaps on every earlier block still fail the requirement and trigger rerouting. Among qualifying candidates, the API returns the route with the smallest risk score, breaking ties with walking time. The risk score uses only these internal factors:

```text
edge risk = (9 × missing-sidewalk factor
           + 7 × major-crossing factor
           + 6 × vehicle-speed factor
           + 10 × traffic-volume factor) / 40

traffic-volume factor = √(AADT / 40,000), capped at 1

route risk = distance-weighted sum of edge risk
```

When `LIVE_SERVICES=false`, the API uses the bundled development graph and weighted Dijkstra. This fallback exists for local testing and does not provide Atlanta-wide coverage.

Route checks depend on mapped OpenStreetMap attributes. Missing or outdated map data can cause a route to fail a requirement or make the result incomplete, so the interface describes the checks as mapped-data results.

## Live services

Default providers work for local development and can be replaced through environment variables:

| Purpose                       | Default provider                                    | Setting                     |
| ----------------------------- | --------------------------------------------------- | --------------------------- |
| Atlanta school directory      | Fulton County/Atlanta ArcGIS Feature Service        | `SCHOOL_DIRECTORY_URL`      |
| Annual average daily traffic  | GDOT TADA 2025 statewide count stations             | `GDOT_TRAFFIC_DATA_PATH`    |
| Starting-address autocomplete | Photon                                              | `AUTOCOMPLETE_SEARCH_URL`   |
| Reverse geocoding             | Nominatim                                           | `GEOCODER_REVERSE_URL`      |
| Pedestrian routes             | Valhalla                                            | `ROUTING_URL`               |
| Route street attributes       | Valhalla trace attributes / OpenStreetMap           | `ROUTE_ATTRIBUTES_URL`      |
| Atlanta sidewalk inventory    | ArcGIS Feature Service                              | `ATLANTA_SIDEWALK_DATA_URL` |
| Traffic lights                | City of Atlanta Signalized Intersections            | `TRAFFIC_SIGNALS_DATA_URL`  |
| Stop signs                    | City of Atlanta Signs Inventory (active R1-1 signs) | `STOP_SIGNS_DATA_URL`       |
| Separate sidewalk geometry    | Overpass API / OpenStreetMap                        | `SIDEWALK_DATA_URL`         |
| Map tiles                     | OpenStreetMap through MapLibre                      | `VITE_MAP_STYLE_URL`        |

The API caches responses and applies upstream timeouts. Before a public launch, use contracted or self-hosted geocoding, routing, and map-tile infrastructure and review each provider's usage policy.

## Browser storage

| Key                     | Contents                         |
| ----------------------- | -------------------------------- |
| `walkwise-home`         | Home label and coordinates       |
| `walkwise-requirements` | Selected route-factor checkboxes |

No password, profile, Family membership, or live trip location is collected.

## Source layout

| Path                       | Responsibility                                                            |
| -------------------------- | ------------------------------------------------------------------------- |
| `src/App.tsx`              | Planner state, local Home persistence, saved schools, and Docs page       |
| `src/DestinationPanel.tsx` | Address/school inputs, route summary, details, and Start Walk action      |
| `src/MapView.tsx`          | MapLibre map, route rendering, markers, crossings, and map interaction    |
| `shared/routing.ts`        | Route schemas, risk calculation, and Dijkstra fallback                    |
| `server/live.ts`           | Live school, geocoding, routing, and OpenStreetMap attribute integrations |
| `server/index.ts`          | HTTP API and production frontend server                                   |
| `tests/`                   | Route, map, school, and local Home behavior tests                         |

MapLibre route rendering reference: [MapLibre GeoJSON line example](https://maplibre.org/maplibre-gl-js/docs/examples/geojson-line/). The default map uses OpenStreetMap tiles with visible attribution; follow the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) before scaling traffic.

Crossing annotations match Valhalla's crossing positions to the City of Atlanta Signalized Intersections layer and active R1-1 records in the city's 2018 Signs Inventory. They load after the route line so they do not delay ordinary directions.
