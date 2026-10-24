# Walkwise Atlanta

An Atlanta school walking-route planner.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. This starts both Vite and the API on port 3001. Map tiles, address search, and live routing require an internet connection. No API keys are needed for the default providers.

## Deploy

The frontend and API run together in a Cloudflare Worker at [walkwise.johnrachwalski.com](https://walkwise.johnrachwalski.com). Sign in with `npx wrangler login`, then run `npm run deploy`. Cloudflare serves `dist/` as static assets and sends `/api/*` to the Express app in `worker/index.ts`. Run `npm run build:worker` to check the bundle without deploying, or `npm run dev:worker` to test the Worker locally. The custom domain and account are set in `wrangler.jsonc`.

The API process needs outbound HTTPS access to the school directory, geocoder, and routing providers. If it is launched inside a restricted environment, live requests will fail even though `/api/health` responds locally. Run `npm run dev` from a normal terminal with network access.

If the live school directory or routing provider is unavailable, the app shows an error instead of presenting demo data as a real walking route. Route downloads still work when map tiles fail, but the exported image warns that it contains only the route line and cannot be used for navigation.

The app shows one completed route after checking candidates; it does not silently switch routes afterward. The blue line is the walk. Orange dashes mean sidewalk data is missing. Blue or green footprints mark mapped crosswalks. Orange and red warnings flag places to inspect on the map. When no candidate passes every selected check, the best walkable route appears with warnings. The in-app **Docs** panel lists data sources and scoring rules.

## Download a route

Choose a starting point and school. Once a checked route is available, select **Download PNG** or **Download PDF** in the route card. The file includes the whole route, A/B endpoints, distance, walking time, and a north-up compass. The export uses the current map style and restores your map view afterward.

## Checks

```sh
npm run build
npm test
npm run test:resilience
npm run test:mobile
npm run test:stress
node scripts/verify-exports.mjs
```

The browser and stress checks require the local servers. The browser checks also require Microsoft Edge. They use fixed routes to test desktop and phone layouts, service failure handling, and PNG/PDF downloads without relying on live providers. The full `npm run test:ui` check exercises real external providers and requires those services to be reachable. Screenshot and export artifacts are written to `.qa/`.
