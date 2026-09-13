import { useEffect, useState } from "react";
import type { Place } from "../../shared/demo";
import { schools as fallbackSchools } from "../../shared/schools";

let cached: Place[] | null = null;
let pending: Promise<Place[]> | null = null;

export function loadAtlantaSchools() {
  if (cached) return Promise.resolve(cached);
  if (!pending)
    pending = fetch("/api/schools")
      .then(async (response) => {
        if (!response.ok) throw new Error("School directory unavailable");
        const data = (await response.json()) as { places: Place[] };
        cached = data.places.length ? data.places : fallbackSchools;
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}

export function useSchools() {
  const [schools, setSchools] = useState<Place[]>(cached || fallbackSchools);
  useEffect(() => {
    let active = true;
    loadAtlantaSchools()
      .then((places) => active && setSchools(places))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return schools;
}
