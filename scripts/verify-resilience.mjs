import { chromium, expect } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/schools", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        live: true,
        places: [
          {
            id: "midtown-school",
            name: "Midtown High School",
            kind: "School",
            coordinate: [-84.3727, 33.7808],
            area: "Midtown",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/search?mode=start&**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        places: [
          {
            id: "test-start",
            name: "Piedmont Park",
            kind: "Map point",
            coordinate: [-84.378, 33.7869],
            area: "Atlanta",
          },
        ],
      }),
    }),
  );
  let routeAttempts = 0;
  await page.route("**/api/routes", (route) => {
    routeAttempts++;
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Live routing unavailable" }),
    });
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.locator(".poi.place-marker")).toHaveCount(1, {
    timeout: 15000,
  });
  await page.locator(".poi.place-marker").click();
  await expect(
    page.getByRole("textbox", { name: "Destination school" }),
  ).toHaveValue("Midtown High School");
  await expect(page.locator(".place-popup")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Starting point" }).fill("Piedmont");
  await page
    .locator(".place-results")
    .getByRole("button", { name: /Piedmont Park/ })
    .click();
  await expect(page.locator(".route-error")).toContainText(
    "Live routing unavailable",
  );
  await expect(page.locator(".route-card")).toHaveCount(0);
  expect(routeAttempts).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  console.log("Resilience browser checks passed");
} finally {
  await browser.close();
}
