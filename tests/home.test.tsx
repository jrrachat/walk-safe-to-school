// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Place } from "../shared/demo";
vi.mock("../src/MapView", () => ({
  default: ({ onPick }: { onPick: (p: Place) => void }) => (
    <button
      onClick={() =>
        onPick({
          id: "map-point",
          name: "Map point",
          kind: "Map point",
          area: "Atlanta",
          coordinate: [-84.3838, 33.7828],
        })
      }
    >
      Pick map point
    </button>
  ),
}));
import App from "../src/App";
const homeAddress: Place = {
  id: "search-home",
  name: "225 Baker Street Northwest",
  kind: "Map point",
  area: "225 Baker Street Northwest, Atlanta, Georgia 30313",
  coordinate: [-84.3951, 33.7633],
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/search"))
        return {
          ok: true,
          json: async () => ({ places: [homeAddress] }),
        } as Response;
      throw new Error("Offline demo");
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("stores Home locally without requiring an account", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Set home" }));
  expect(
    (screen.getByRole("button", { name: "Save as Home" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const input = screen.getByRole("textbox", { name: "Home address" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "225 Baker" } });
  fireEvent.click(
    await screen.findByRole("button", {
      name: /225 Baker Street Northwest/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save as Home" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    screen.getByRole("textbox", { name: "Starting point" }),
  ).toHaveProperty("value", "Home");
  expect(screen.getByRole("button", { name: "From home" })).toBeTruthy();
  expect(Object.keys(localStorage).sort()).toEqual([
    "walkwise-avoid-busy-roads",
    "walkwise-home",
    "walkwise-requirements",
    "walkwise-requirements-version",
  ]);
  expect(JSON.parse(localStorage.getItem("walkwise-home") || "null")).toEqual({
    area: homeAddress.area,
    coordinate: homeAddress.coordinate,
  });
  cleanup();
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Starting point" }),
    ).toHaveProperty("value", "Home"),
  );
  expect(screen.queryByRole("button", { name: "Saved Schools" })).toBeNull();
  expect(screen.queryByText("Required route factors")).toBeNull();
});
it("requires an address result instead of a map click or device location", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Set home" }));
  expect(screen.getByRole("textbox", { name: "Home address" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choose on map" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Use current location" }),
  ).toBeNull();
});
