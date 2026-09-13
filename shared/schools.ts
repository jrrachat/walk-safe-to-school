import { places, type Place } from "./demo";
export function isAtlantaSchool(place: Place) {
  const [lon, lat] = place.coordinate;
  return (
    place.kind === "School" &&
    lon >= -84.56 &&
    lon <= -84.27 &&
    lat >= 33.65 &&
    lat <= 33.92
  );
}
export const schools = places.filter(isAtlantaSchool);
export const demoStart: Place = {
  id: "demo-start",
  name: "Example starting point",
  kind: "Map point",
  coordinate: [-84.3867, 33.781],
  area: "Midtown",
};
