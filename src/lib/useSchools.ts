import { useEffect, useState } from "react";
import type { Place } from "../../shared/demo";

let cached: Place[] | null = null;
let pending: Promise<Place[]> | null = null;

export function loadAtlantaSchools() {
  if (cached) return Promise.resolve(cached);
  if (!pending)
    pending = fetch("/api/schools")
      .then(async (response) => {
        if (!response.ok) throw new Error("School directory unavailable");
        const data = (await response.json()) as {
          places: Place[];
          live: boolean;
        };
        if (!data.live || !data.places.length)
          throw new Error("School directory unavailable");
        cached = data.places;
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}

export function useSchools() {
  const [schools, setSchools] = useState<Place[]>(cached || []);
  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    const refresh = () => {
      loadAtlantaSchools()
        .then((places) => {
          if (active) setSchools(places);
        })
        .catch(() => {
          if (active) retry = window.setTimeout(refresh, 15000);
        });
    };
    refresh();
    return () => {
      active = false;
      window.clearTimeout(retry);
    };
  }, []);
  return schools;
}
