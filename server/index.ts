import express from "express";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  coordinateSchema,
  requiredRoutes,
  requirementSchema,
  validateGraph,
} from "../shared/routing";
import { demoGraph } from "../shared/demo";
import { schools as fallbackSchools } from "../shared/schools";
import {
  liveProviders,
  liveRouteDetails,
  liveRoutes,
  RouteNotPossibleError,
  loadSchools,
  reverseLocation,
  searchLocations,
} from "./live";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
const graph = process.env.WALK_GRAPH_PATH
  ? validateGraph(JSON.parse(readFileSync(process.env.WALK_GRAPH_PATH, "utf8")))
  : demoGraph;
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", live: true, providers: liveProviders() }),
);
app.get("/api/schools", async (_req, res) => {
  try {
    res.json({ places: await loadSchools(), live: true });
  } catch {
    res.json({
      places: fallbackSchools,
      live: false,
      message: "Live school directory is temporarily unavailable.",
    });
  }
});
app.get("/api/places", async (req, res) => {
  const q = String(req.query.q || "")
    .toLowerCase()
    .slice(0, 100);
  try {
    const places = await loadSchools();
    res.json(
      places.filter((place) =>
        (place.name + " " + place.area).toLowerCase().includes(q),
      ),
    );
  } catch {
    res.json(fallbackSchools);
  }
});
app.get("/api/search", async (req, res) => {
  const parsed = z.string().trim().min(2).max(160).safeParse(req.query.q);
  const schoolsOnly = req.query.mode !== "start";
  if (!parsed.success) {
    res.status(400).json({ error: "Enter at least two characters." });
    return;
  }
  try {
    res.json({ places: await searchLocations(parsed.data, schoolsOnly) });
  } catch {
    res.status(502).json({
      error: schoolsOnly
        ? "Live school search is temporarily unavailable."
        : "Address search is temporarily unavailable. Use your current location or choose a point on the map.",
    });
  }
});
app.get("/api/reverse", async (req, res) => {
  const parsed = z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid map coordinates." });
    return;
  }
  try {
    res.json({
      place: await reverseLocation(parsed.data.lat, parsed.data.lon),
    });
  } catch {
    res
      .status(502)
      .json({ error: "Address lookup is temporarily unavailable." });
  }
});
app.post("/api/route-details", async (req, res) => {
  const input = z
    .object({ coordinates: z.array(coordinateSchema).min(2).max(1500) })
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Invalid route geometry." });
    return;
  }
  try {
    res.json(await liveRouteDetails(input.data.coordinates));
  } catch {
    res
      .status(502)
      .json({ error: "Crossing details are temporarily unavailable." });
  }
});

app.post("/api/routes", async (req, res) => {
  const input = z
    .object({
      start: coordinateSchema,
      end: coordinateSchema,
      requirements: requirementSchema,
      avoidBusyRoads: z.boolean().default(true),
    })
    .safeParse(req.body);
  if (!input.success) {
    res
      .status(400)
      .json({ error: "Invalid coordinates or route requirements." });
    return;
  }
  if (process.env.LIVE_SERVICES === "false") {
    try {
      res.json({
        routes: requiredRoutes(
          graph,
          input.data.start,
          input.data.end,
          input.data.requirements,
        ),
        live: false,
        source: graph.source,
      });
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? error.message : "Route unavailable",
      });
    }
    return;
  }
  try {
    res.json({
      routes: await liveRoutes(
        input.data.start,
        input.data.end,
        input.data.requirements,
        input.data.avoidBusyRoads,
      ),
      live: true,
      source: "OpenStreetMap pedestrian routes via Valhalla",
      requirementNote:
        "The selected route fulfills every checked requirement using mapped route attributes.",
    });
  } catch (error) {
    if (error instanceof RouteNotPossibleError) {
      res
        .status(422)
        .json({ error: "Route not possible.", route: error.route });
      return;
    }
    res.status(502).json({
      error:
        "Live walking routes are temporarily unavailable. Check the start and school, then try again.",
    });
  }
});
app.use(express.static("dist"));
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({
      error: err instanceof Error ? "Invalid request" : "Request failed",
    });
  },
);
app.listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log("Walkwise API: http://127.0.0.1:3001"),
);
