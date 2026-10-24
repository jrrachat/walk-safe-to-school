import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:5173/";
await fs.mkdir(".qa", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const school = {
    id: "test-school",
    name: "Test High School",
    kind: "School",
    coordinate: [-84.3727, 33.7808],
    area: "Atlanta",
  };
  const start = {
    id: "test-start",
    name: "Piedmont Park",
    kind: "Map point",
    coordinate: [-84.378, 33.7869],
    area: "Atlanta",
  };
  const warning = {
    requirement: "sidewalks",
    coordinate: [-84.375, 33.784],
    label: "No mapped sidewalk on Test Road",
    geometry: [start.coordinate, school.coordinate],
  };
  const crossingCoordinate = [-84.3766, 33.78555];
  const routeData = {
    category: "Lower Risk",
    nodes: [],
    edges: [],
    coordinates: [start.coordinate, warning.coordinate, school.coordinate],
    meters: 1100,
    minutes: 15,
    risk: 18,
    cost: 1100,
    breakdown: { sidewalk: 18, crossings: 0, speed: 0, traffic: 0 },
    duplicate: false,
    checks: {
      speed: { applicable: true, passes: true },
      crosswalks: { applicable: true, passes: true },
      sidewalks: { applicable: true, passes: false },
    },
    crossings: [
      {
        coordinate: [-84.3774, 33.78632],
        marked: true,
        signalized: true,
      },
      {
        coordinate: crossingCoordinate,
        marked: false,
        signalized: false,
      },
    ],
    alerts: [warning],
    violations: [],
  };
  await page.route("**/api/schools", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ live: true, places: [school] }),
    }),
  );
  await page.route("**/api/search?mode=start&**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ places: [start] }),
    }),
  );
  let routeRequests = 0;
  await page.route("**/api/routes", async (route) => {
    routeRequests++;
    const fast = route.request().postDataJSON().fast;
    expect(fast).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        routes: [{ ...routeData, meters: 1200 }],
        live: true,
        refining: false,
      }),
    });
  });
  await page.route("**/api/route-details", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ crossings: routeData.crossings }),
    }),
  );
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Starting point" }).focus();
  await expect(page.locator(".place-results")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Starting point" }).fill("Piedmont");
  await page
    .locator(".place-results")
    .getByRole("button", { name: /Piedmont Park/ })
    .click();
  await page.getByRole("textbox", { name: "Destination school" }).fill("Test");
  await page
    .locator(".place-results")
    .getByRole("button", { name: /Test High School/ })
    .click();
  await expect(page.locator(".route-card")).toBeVisible();
  await expect(page.locator(".crossing-marker")).toHaveCount(0);
  await expect(page.locator(".route-refining")).toHaveCount(0);
  await expect(page.locator(".route-stats")).toContainText("0.75 mi");
  await page.waitForTimeout(800);
  expect(routeRequests).toBe(1);
  await expect(page.locator(".brand-name")).toHaveText("Walkwise Atlanta");
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [430, 932],
    [768, 1024],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await expect(page.locator(".planner")).toBeVisible();
    const brand = await page.locator(".brand").boundingBox();
    const docsButton = await page
      .getByRole("button", { name: "About routes and data" })
      .boundingBox();
    expect(brand.x + brand.width).toBeLessThan(docsButton.x);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const targets = await page
      .locator(".route-downloads button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );
    expect(targets.every((height) => height >= 44)).toBe(true);
    await page.screenshot({ path: `.qa/mobile-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const crossingWarning = page.locator(".crossing-warning-marker");
  await expect(crossingWarning).toHaveCSS("width", "38px");
  await page.waitForTimeout(600);
  const markerTransform = await crossingWarning.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await crossingWarning.hover();
  await expect(
    crossingWarning.locator(".crossing-warning-detail"),
  ).toBeVisible();
  await expect(crossingWarning).toHaveCSS("width", "38px");
  expect(
    await crossingWarning.evaluate(
      (element) => getComputedStyle(element).transform,
    ),
  ).toBe(markerTransform);
  await page.screenshot({ path: ".qa/warning-hover.png" });
  await crossingWarning.click();
  await expect(crossingWarning).toHaveAttribute("aria-expanded", "true");
  await expect(crossingWarning.locator(".crossing-warning-detail")).toHaveCSS(
    "color",
    "rgb(35, 53, 75)",
  );
  const warningMarker = page.locator(".route-violation-marker").first();
  await expect(warningMarker).toHaveCSS("width", "28px");
  await warningMarker.click();
  await expect(warningMarker).toHaveClass(/expanded/);
  await page.locator(".maplibregl-ctrl-zoom-in").click();
  await expect(crossingWarning).toHaveCSS("width", "38px");
  expect(routeRequests).toBe(1);
  await page.getByRole("button", { name: "About routes and data" }).click();
  await expect(page.locator(".docs-summary")).toBeVisible();
  await expect(page.locator(".map-region")).toBeHidden();
  await page.getByText("Data sources", { exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: ".qa/mobile-docs.png" });
  await page.getByRole("button", { name: "Back to map" }).click();
  await page.getByRole("button", { name: "Set home" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: ".qa/mobile-home-modal.png" });
  expect(errors).toEqual([]);
  console.log("Mobile layout checks passed at 320, 390, 430, 768, and 844px");
} finally {
  await browser.close();
}
