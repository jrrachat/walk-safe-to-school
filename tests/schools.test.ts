import { expect, it } from "vitest";
import { isAtlantaSchool, schools } from "../shared/schools";
import { places } from "../shared/demo";
it("excludes non-school destinations and out-of-area schools", () => {
  expect(schools.length).toBeGreaterThan(0);
  for (const place of places.filter((p) => p.kind !== "School"))
    expect(isAtlantaSchool(place)).toBe(false);
  expect(isAtlantaSchool({ ...schools[0], coordinate: [-73.98, 40.75] })).toBe(
    false,
  );
  expect(isAtlantaSchool({ ...schools[0], name: "My school" })).toBe(true);
});
