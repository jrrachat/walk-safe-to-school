# Walkwise

An Atlanta school walking-route planner.

## Run locally

Requires Node.js 20.19+ or 22.12+.

~~~sh
npm install
npm run dev
~~~

Open http://127.0.0.1:5173. This starts both Vite and the API on port 3001. Map tiles, address search, and live routing require an internet connection. No API keys are needed for the default providers.

## Download a route

Choose a starting point and school. Once a route is available, select **Download PNG** or **Download PDF** in the route card. The file includes the whole route, A/B endpoints, distance, walking time, and a north-up compass. The export uses the current map style and restores your map view afterward. Downloads are unavailable while routing or when the route fails the selected requirements.

## Checks

~~~sh
npm run build
npm test
node scripts/verify-exports.mjs
~~~

The export browser check requires the local servers and Microsoft Edge. It uses a fixed test route, verifies PNG/PDF downloads at desktop and phone sizes, and writes artifacts to .qa/.
