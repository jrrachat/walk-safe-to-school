// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PlaceSearch from "../src/PlaceSearch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows loaded school matches without waiting for another search request", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({
      live: true,
      places: [
        {
          id: "midtown",
          name: "Midtown High School",
          kind: "School",
          area: "Atlanta",
          coordinate: [-84.37, 33.78],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <PlaceSearch
      label="Destination school"
      value={null}
      onChoose={() => {}}
      prominent
    />,
  );
  const input = screen.getByRole("textbox", { name: "Destination school" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Midtown" } });
  expect(
    await screen.findByRole("button", { name: /Midtown High School/ }),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/schools");
  fireEvent.change(input, { target: { value: "Northside" } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(String(fetchMock.mock.calls[1][0])).toContain(
    "/api/search?mode=school&q=Northside",
  );
});

it("ignores a search response after the search is closed and reopened", async () => {
  let finishSearch!: (response: Response) => void;
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    String(input).includes("/api/search")
      ? new Promise<Response>((resolve) => {
          finishSearch = resolve;
        })
      : Promise.reject(new Error("School directory unavailable")),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <PlaceSearch label="Starting point" value={null} onChoose={() => {}} />,
  );
  const input = screen.getByRole("textbox", { name: "Starting point" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Baker" } });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/search")),
    ).toBe(true),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Close Starting point search" }),
  );
  fireEvent.focus(input);
  await act(async () => {
    finishSearch(
      Response.json({
        places: [
          {
            id: "old-result",
            name: "Old Baker result",
            kind: "Map point",
            area: "Atlanta",
            coordinate: [-84.39, 33.76],
          },
        ],
      }),
    );
  });
  expect(screen.queryByRole("button", { name: /Old Baker result/ })).toBeNull();
});
