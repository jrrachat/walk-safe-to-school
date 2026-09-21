import { chromium, expect } from "@playwright/test";
import { PNG } from "pngjs";
import fs from "node:fs/promises";

const base = process.argv[2] || "http://127.0.0.1:5173/";
const school = {
  id: "school",
  name: "Midtown High School",
  kind: "School",
  area: "Midtown",
  coordinate: [-84.3727, 33.7808],
};
const route = {
  category: "Lower Risk",
  nodes: [],
  edges: [],
  coordinates: [
    [-84.3867, 33.781],
    [-84.3849, 33.781],
    [-84.3822, 33.781],
    [-84.3794, 33.781],
    [-84.3767, 33.781],
    [-84.3741, 33.781],
    [-84.3727, 33.7808],
  ],
  meters: 1320,
  minutes: 18,
  risk: 0,
  cost: 1320,
  breakdown: { sidewalk: 0, crossings: 0, speed: 0 },
  duplicate: false,
};
await fs.mkdir(".qa", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failedRoute = false;
try {
  await page.addInitScript(() => {
    localStorage.setItem(
      "walkwise-home",
      JSON.stringify({
        area: "Test starting point",
        coordinate: [-84.3867, 33.781],
      }),
    );
  });
  await page.route("**/api/schools", (r) =>
    r.fulfill({ json: { places: [school], live: true } }),
  );
  await page.route("**/api/search?*", (r) =>
    r.fulfill({ json: { places: [school] } }),
  );
  await page.route("**/api/routes", (r) =>
    r.fulfill({
      status: failedRoute ? 422 : 200,
      json: failedRoute
        ? { error: "Route not possible.", route }
        : { routes: [route] },
    }),
  );
  await page.route("**/api/route-details", (r) =>
    r.fulfill({ json: { crossings: [] } }),
  );
  async function chooseSchool() {
    await page
      .getByRole("textbox", { name: "Destination school", exact: true })
      .fill("Midtown");
    await page
      .locator(".place-results")
      .getByRole("button", { name: /Midtown High School/ })
      .first()
      .click();
  }
  await page.goto(base);
  await page.evaluate(() => {
    new MutationObserver(() => {
      const t = document.querySelector(".toast");
      if (t) console.log("EXPORT STATUS: " + t.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  });
  page.on("console", (msg) => {
    if (msg.text().includes("EXPORT STATUS")) console.log(msg.text());
  });
  await chooseSchool();
  await expect(page.locator(".place-marker.origin")).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("button", { name: "Download PNG" }),
  ).toBeVisible();
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 950 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(viewport);
    // Ensure the map has rendered its initial route and tiles before exporting.
    await expect
      .poll(() => page.locator(".map canvas").evaluate((c) => c.width))
      .toBeGreaterThan(0);
    const originalBox = await page.locator(".map").boundingBox();
    for (const format of ["PNG", "PDF"]) {
      const downloadPromise = page.waitForEvent("download", { timeout: 35000 });
      await page.getByRole("button", { name: "Download " + format }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(
        "walk-to-midtown-high-school." + format.toLowerCase(),
      );
      const path = ".qa/route-" + label + "." + format.toLowerCase();
      await download.saveAs(path);
      const data = await fs.readFile(path);
      if (format === "PNG") {
        const png = PNG.sync.read(data);
        expect(png.width).toBe(1600);
        expect(png.height).toBe(1393);
        let routePixels = 0,
          compassPixels = 0,
          startPixels = 0,
          endPixels = 0;
        for (let y = 0; y < png.height; y++)
          for (let x = 0; x < png.width; x++) {
            const i = (y * png.width + x) * 4;
            const [r, g, b] = png.data.subarray(i, i + 3);
            if (r < 55 && g > 45 && g < 140 && b > 170) {
              if (y > 200 && y < 1333) routePixels++;
              if (y < 200 && x > 1300) compassPixels++;
            }
            if (y > 200 && y < 1333 && r < 40 && g > 80 && g < 140 && b < 100)
              startPixels++;
            if (y > 200 && y < 1333 && r > 90 && r < 150 && g < 90 && b > 140)
              endPixels++;
          }
        expect(routePixels).toBeGreaterThan(1500);
        expect(compassPixels).toBeGreaterThan(300);
        expect(startPixels).toBeGreaterThan(300);
        expect(endPixels).toBeGreaterThan(300);
      } else {
        expect(data.subarray(0, 5).toString()).toBe("%PDF-");
        expect(data.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(
          1,
        );
        expect(data.length).toBeGreaterThan(10000);
      }
      await expect(
        page.getByRole("button", { name: "Download PNG" }),
      ).toBeEnabled();
      const restoredBox = await page.locator(".map").boundingBox();
      expect(restoredBox.width).toBe(originalBox.width);
      expect(restoredBox.height).toBe(originalBox.height);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({ path: ".qa/export-ui-" + label + ".png" });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  failedRoute = true;
  await page.getByRole("checkbox", { name: /Avoid busier roads/ }).uncheck();
  await expect(
    page.getByText("Route not possible.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "desktop and phone PNG/PDF downloads",
        "full route pixels",
        "compass pixels",
        "A/B markers",
        "one-page PDF",
        "restored map size",
        "no horizontal overflow",
        "failed routes cannot export",
      ],
    }),
  );
} catch (error) {
  console.error(
    "Visible status:",
    await page.locator('[role="status"]').allTextContents(),
  );
  await page.screenshot({ path: ".qa/export-failure.png" });
  throw error;
} finally {
  await browser.close();
}
