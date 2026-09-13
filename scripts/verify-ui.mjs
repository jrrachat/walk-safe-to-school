import { chromium, expect } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:5173/";
await fs.mkdir(".qa", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function routePixels() {
  const map = await page.locator(".map-region").boundingBox();
  const panel = await page.locator(".planner").boundingBox();
  const mobile = page.viewportSize().width <= 900;
  const visibleHeight = mobile ? Math.max(1, panel.y - map.y) : map.height;
  const image = PNG.sync.read(
    await page.screenshot({
      clip: { x: map.x, y: map.y, width: map.width, height: visibleHeight },
    }),
  );
  let pixels = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, g, b] = image.data.subarray(i, i + 3);
    if (r < 55 && g > 45 && g < 140 && b > 170) pixels++;
  }
  return pixels;
}
try {
  await page.addInitScript(() => {
    localStorage.setItem(
      "walkwise-requirements",
      JSON.stringify({ speed: false, crosswalks: false, sidewalks: false }),
    );
    localStorage.setItem("walkwise-requirements-version", "all-checked-v1");
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Which school are you going to?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Family", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Profile", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".place-marker.origin")).toHaveCount(0);
  const schoolResponse = await page.request.get(
    new URL("/api/schools", base).href,
  );
  const schoolDirectory = await schoolResponse.json();
  expect(schoolDirectory.live).toBe(true);
  expect(schoolDirectory.places.length).toBeGreaterThan(50);
  await expect
    .poll(() => page.locator(".poi .place-marker-label").count())
    .toBeGreaterThan(50);
  const routeResponse = await page.request.post(
    new URL("/api/routes", base).href,
    {
      data: {
        start: [-84.3963, 33.7634],
        end: [-84.3727, 33.7808],
        requirements: {
          speed: false,
          crosswalks: false,
          sidewalks: false,
        },
      },
    },
  );
  const routeData = await routeResponse.json();
  expect(routeResponse.ok()).toBe(true);
  expect(routeData.routes).toHaveLength(1);
  expect(routeData.routes[0].checks).toBeTruthy();
  expect(routeData.routes[0].breakdown.traffic).toBeGreaterThan(0);
  expect(typeof routeData.routes[0].checks.sidewalks.passes).toBe("boolean");
  expect(
    routeData.routes[0].alerts.some(
      (alert) =>
        alert.requirement === "sidewalks" && alert.geometry?.length > 1,
    ),
  ).toBe(true);
  const retiredRequest = await page.request.post(
    new URL("/api/routes", base).href,
    {
      data: {
        start: [-84.3963, 33.7634],
        end: [-84.3727, 33.7808],
        weights: { sidewalk: 9, crossings: 7, speed: 6 },
      },
    },
  );
  expect(retiredRequest.status()).toBe(400);
  await expect(
    page.getByRole("button", { name: "Saved Schools", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Atlanta schools", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Required route factors", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Data and API documentation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Data & APIs" }),
  ).toBeVisible();
  await expect(page.locator(".api-row")).toHaveCount(12);
  await expect(
    page.getByRole("heading", { name: "Routing algorithm" }),
  ).toBeVisible();
  await expect(
    page.getByText("Bidirectional A* with traffic and road-class exposure"),
  ).toBeVisible();
  await expect(page.locator(".algorithm-formula")).toContainText(
    "R = 100 \u00d7 (9M + 7C + 6V + wT) / (22 + w)",
  );
  const docsHeadings = await page.locator(".docs-page h2").allTextContents();
  expect(docsHeadings.indexOf("Routing algorithm")).toBeLessThan(
    docsHeadings.indexOf("External data"),
  );
  await page.getByRole("button", { name: "Back to map", exact: true }).click();
  await page.getByRole("button", { name: "Set home" }).click();
  await page.getByRole("textbox", { name: "Home address" }).fill("Georgia Aqu");
  await page
    .locator(".modal .place-results")
    .getByRole("button", { name: /Georgia Aquarium/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save as Home" }).click();
  await expect(
    page.getByRole("textbox", { name: "Starting point" }),
  ).toHaveValue("Home");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("walkwise-home")),
    ),
  ).toMatchObject({ area: expect.any(String), coordinate: expect.any(Array) });
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("textbox", { name: "Starting point" }),
  ).toHaveValue("Home");
  await page
    .getByRole("textbox", { name: "Starting point" })
    .fill("Georgia Aqu");
  await expect(
    page.getByRole("textbox", { name: "Destination school", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Search locations" }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.locator(".place-results > button").count())
    .toBeGreaterThan(1);
  await page
    .locator(".place-results")
    .getByRole("button", { name: /Georgia Aquarium/ })
    .first()
    .click();
  await expect(
    page.getByRole("textbox", { name: "Destination school", exact: true }),
  ).toBeVisible();

  const map = await page.locator(".map-region").boundingBox();
  expect(map.width / 1440).toBeGreaterThan(0.7);
  expect(map.width / 1440).toBeLessThan(0.75);
  await page.screenshot({ path: ".qa/desktop-search.png" });
  const automaticSchoolSearch = page.waitForResponse(
    (response) =>
      response.url().includes("/api/search?mode=school") && response.ok(),
  );
  await page
    .getByRole("textbox", { name: "Destination school", exact: true })
    .fill("Washington");
  await automaticSchoolSearch;
  await expect(
    page
      .locator(".place-results")
      .getByRole("button", { name: /Washington HS/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search schools", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Destination school", exact: true })
    .fill("Midtown");
  await page
    .locator(".place-results")
    .getByRole("button", { name: /Midtown (High School|HS)/ })
    .first()
    .click();
  const busyRoadFactor = page.getByRole("checkbox", {
    name: /Avoid busier roads/,
  });
  const speedFactor = page.getByRole("checkbox", {
    name: /No roads over 35 mph/,
  });
  const crosswalkFactor = page.getByRole("checkbox", {
    name: /Crosswalks at required crossings/,
  });
  const sidewalkFactor = page.getByRole("checkbox", {
    name: /Sidewalks along the route/,
  });
  await expect(busyRoadFactor).toBeChecked();
  await expect(speedFactor).toBeChecked();
  await expect(crosswalkFactor).toBeChecked();
  await expect(sidewalkFactor).toBeChecked();
  await expect(busyRoadFactor).toBeEnabled();
  await expect(speedFactor).toBeEnabled();
  await expect(crosswalkFactor).toBeEnabled();
  await expect(sidewalkFactor).toBeEnabled();
  await busyRoadFactor.uncheck();
  await speedFactor.uncheck();
  await crosswalkFactor.uncheck();
  await sidewalkFactor.uncheck();
  await expect(page.getByText("Safest route", { exact: true })).toBeVisible({
    timeout: 75000,
  });
  await expect(page.locator(".route-card")).toHaveCount(1);
  await expect(
    page.locator(".destination-school .place-marker-label"),
  ).toHaveText("Destination school");
  await expect(
    page.locator(".place-marker-label", { hasText: "Midtown High School" }),
  ).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await expect(
    page.getByRole("checkbox", { name: /Crossing lights/ }),
  ).toHaveCount(0);
  await expect(page.locator(".factor-check small")).toHaveCount(0);
  await expect(page.getByText("Route factors", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Destination school", exact: true }),
  ).toBeVisible();
  await speedFactor.check();
  await expect
    .poll(
      async () =>
        (await page.locator(".route-card").count()) +
        (await page.locator(".route-error").count()),
      { timeout: 75000 },
    )
    .toBe(1);
  if (await page.locator(".route-error").count()) {
    await expect(
      page.getByText("Route not possible.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".route-violation-marker").first()).toBeVisible();
  }
  await speedFactor.uncheck();
  await expect(page.locator(".route-card")).toHaveCount(1, { timeout: 30000 });
  await expect(sidewalkFactor).not.toBeChecked();
  await expect(sidewalkFactor).toBeEnabled();
  await expect(page.locator(".route-error")).toHaveCount(0);
  await expect(page.locator(".sidewalk-warning").first()).toBeVisible();
  await sidewalkFactor.check();
  await expect(sidewalkFactor).toBeChecked();
  await expect
    .poll(
      async () =>
        (await page.locator(".route-card").count()) +
        (await page.locator(".route-error").count()),
      { timeout: 75000 },
    )
    .toBe(1);
  if (await page.locator(".route-error").count()) {
    await expect(
      page.getByText("Route not possible.", { exact: true }),
    ).toBeVisible();
  }
  await sidewalkFactor.uncheck();
  await expect(sidewalkFactor).not.toBeChecked();
  await expect(page.locator(".route-card")).toHaveCount(1, { timeout: 30000 });
  const controlledCrossing = page.locator(".crossing-marker.signalized");
  await expect(controlledCrossing.first()).toBeVisible({ timeout: 15000 });
  expect(
    (await controlledCrossing.allTextContents()).every((label) => label === ""),
  ).toBe(true);
  expect(
    await controlledCrossing.evaluateAll((markers) =>
      markers.every(
        (marker) =>
          marker.querySelector("svg") &&
          marker.getAttribute("aria-label")?.startsWith("Crossing symbol"),
      ),
    ),
  ).toBe(true);
  const walkingMarkerBoxes = await page
    .locator(".crossing-marker:visible")
    .evaluateAll((markers) =>
      markers.map((marker) => {
        const box = marker.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    );
  for (let first = 0; first < walkingMarkerBoxes.length; first++) {
    for (let second = first + 1; second < walkingMarkerBoxes.length; second++) {
      const a = walkingMarkerBoxes[first];
      const b = walkingMarkerBoxes[second];
      expect(
        a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top,
      ).toBe(false);
    }
  }
  await expect(page.locator(".map-key")).toHaveAttribute("open", "");
  await expect(page.getByText("Map key", { exact: true })).toBeVisible();
  await expect(page.getByText("MapLibre key", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Busier road (yellow)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Less busy road (white)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sidewalk (red dashed)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Route (blue)", { exact: true })).toBeVisible();
  await expect(page.locator(".map-key-image")).toHaveCount(4);
  await expect(page.locator(".map-key-walking")).toHaveCount(2);
  await expect(
    page.getByText("Crossing symbol", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Crossing symbol (crossing lights)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Suspected no crossing markings", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".map-key-warning-strip")).toHaveCount(1);
  expect(
    await page.evaluate(() => {
      const factors = document.querySelector(".route-factors");
      const key = document.querySelector(".map-key");
      return Boolean(
        factors &&
        key &&
        factors.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  expect(
    await page
      .locator(".map-key-image")
      .evaluateAll((images) =>
        images.every(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  await expect.poll(routePixels, { timeout: 15000 }).toBeGreaterThan(1500);
  await page.screenshot({ path: ".qa/desktop-route.png" });
  await page.locator(".destination-school.place-marker").click();
  await expect(page.locator(".place-popup")).toBeVisible();
  await expect(
    page.locator(".place-popup").getByRole("button", { name: "Save School" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".place-popup")
      .getByRole("button", { name: "Get Directions" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Destination school", exact: true })
    .fill("Midtown");
  await page
    .locator(".place-results")
    .getByRole("button", { name: /Midtown (High School|HS)/ })
    .first()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator(".map-tools, .show-route, .map-bottom"),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      page
        .getByRole("textbox", { name: "Starting point" })
        .evaluate((element) => getComputedStyle(element).fontWeight),
    )
    .toBe("700");
  await expect.poll(routePixels, { timeout: 15000 }).toBeGreaterThan(80);
  await page.screenshot({ path: ".qa/phone-route.png" });
  await expect(
    page.getByRole("button", { name: "Start Walk", exact: true }),
  ).toHaveCount(0);
  const handle = page.getByRole("button", { name: "Resize destination panel" });
  let box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 110, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".planner")).toHaveAttribute(
    "data-sheet",
    "collapsed",
  );
  await page.screenshot({ path: ".qa/phone-collapsed.png" });
  box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 140, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".planner")).toHaveAttribute("data-sheet", "half");
  await handle.press("ArrowUp");
  await expect(page.locator(".planner")).toHaveAttribute(
    "data-sheet",
    "expanded",
  );
  await handle.press("ArrowDown");
  for (const [width, height] of [
    [320, 568],
    [768, 1024],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({ path: ".qa/layout-" + width + ".png" });
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "no default Midtown origin",
        "school field hidden during address search",
        "single qualifying live route",
        "single-screen route information",
        "live school directory",
        "automatic destination-school search",
        "algorithm and variables at top of Docs",
        "GDOT AADT traffic risk",
        "any-address start",
        "automatic starting-place suggestions",
        "account-free persistent Home",
        "inline route-factor checkboxes",
        "all factors checked by default",
        "editable sidewalk routing",
        "mapped sidewalk-gap stretches",
        "named speed-limit callouts",
        "live separate-sidewalk requirement",
        "Family and Profile navigation removed",
        "API documentation page",
        "desktop map width",
        "rendered route pixels",
        "normal and light-controlled crossing symbols",
        "map popup",
        "school popup directions",
        "phone route pixels",
        "visible route cards",
        "drag down/up",
        "keyboard sheet controls",
        "320/768/844px overflow",
      ],
      base,
    }),
  );
} finally {
  await browser.close();
}
