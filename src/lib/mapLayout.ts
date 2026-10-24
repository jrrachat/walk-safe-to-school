import { distance, type Coordinate } from "../../shared/routing";

/** Project a route annotation onto the line the map actually draws. */
export function pointOnRoute(
  point: Coordinate,
  route: Coordinate[],
  maximumOffsetMeters = 60,
): Coordinate | null {
  if (route.length < 2) return null;
  const metersPerLongitude = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  let closest: Coordinate | null = null;
  let minimum = Infinity;
  for (let index = 0; index < route.length - 1; index++) {
    const start = route[index];
    const end = route[index + 1];
    const dx = (end[0] - start[0]) * metersPerLongitude;
    const dy = (end[1] - start[1]) * 111_320;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 0.01) continue;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - start[0]) * metersPerLongitude * dx +
          (point[1] - start[1]) * 111_320 * dy) /
          lengthSquared,
      ),
    );
    const projected: Coordinate = [
      start[0] + fraction * (end[0] - start[0]),
      start[1] + fraction * (end[1] - start[1]),
    ];
    const offset = distance(point, projected);
    if (offset < minimum) {
      minimum = offset;
      closest = projected;
    }
  }
  return minimum <= maximumOffsetMeters ? closest : null;
}

/** Keep warning strokes on the route that is actually displayed. */
export function sidewalkWarningOnRoute(
  geometry: Coordinate[],
  route: Coordinate[],
  maximumOffsetMeters = 22,
): Coordinate[] {
  if (geometry.length < 2 || route.length < 2) return [];
  const lengths = route
    .slice(1)
    .map((point, index) => distance(route[index], point));
  const progress = [0];
  for (const length of lengths) progress.push(progress.at(-1)! + length);
  const project = (point: Coordinate) => {
    const latitude = (point[1] * Math.PI) / 180;
    const metersPerLongitude = 111_320 * Math.cos(latitude);
    let best = {
      coordinate: route[0],
      offset: Infinity,
      along: 0,
      index: 0,
    };
    for (let index = 0; index < route.length - 1; index++) {
      const start = route[index];
      const end = route[index + 1];
      const dx = (end[0] - start[0]) * metersPerLongitude;
      const dy = (end[1] - start[1]) * 111_320;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared < 0.01) continue;
      const fromX = (point[0] - start[0]) * metersPerLongitude;
      const fromY = (point[1] - start[1]) * 111_320;
      const fraction = Math.max(
        0,
        Math.min(1, (fromX * dx + fromY * dy) / lengthSquared),
      );
      const offset = Math.hypot(fromX - fraction * dx, fromY - fraction * dy);
      if (offset < best.offset)
        best = {
          coordinate: [
            start[0] + fraction * (end[0] - start[0]),
            start[1] + fraction * (end[1] - start[1]),
          ],
          offset,
          along: progress[index] + fraction * lengths[index],
          index,
        };
    }
    return best;
  };
  const first = project(geometry[0]);
  const last = project(geometry.at(-1)!);
  const sourceLength = geometry
    .slice(1)
    .reduce((sum, point, index) => sum + distance(geometry[index], point), 0);
  const span = Math.abs(last.along - first.along);
  if (
    first.offset > maximumOffsetMeters ||
    last.offset > maximumOffsetMeters ||
    span < 4 ||
    span > sourceLength * 1.8 + 20 ||
    sourceLength > span * 1.8 + 20
  )
    return [];
  const [from, to] = first.along <= last.along ? [first, last] : [last, first];
  const matched = [
    from.coordinate,
    ...route.filter(
      (_, index) =>
        index > from.index &&
        index <= to.index &&
        progress[index] > from.along &&
        progress[index] < to.along,
    ),
    to.coordinate,
  ];
  // Endpoints alone can match a route that briefly returns to the same street.
  // Check the warning's full shape against the selected route stretch.
  const stride = Math.max(1, Math.ceil(geometry.length / 12));
  for (let pointIndex = 0; pointIndex < geometry.length; pointIndex += stride) {
    const point = geometry[pointIndex];
    const latitude = (point[1] * Math.PI) / 180;
    const metersPerLongitude = 111_320 * Math.cos(latitude);
    let closest = Infinity;
    for (let index = 0; index < matched.length - 1; index++) {
      const start = matched[index];
      const end = matched[index + 1];
      const dx = (end[0] - start[0]) * metersPerLongitude;
      const dy = (end[1] - start[1]) * 111_320;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared < 0.01) continue;
      const fromX = (point[0] - start[0]) * metersPerLongitude;
      const fromY = (point[1] - start[1]) * 111_320;
      const fraction = Math.max(
        0,
        Math.min(1, (fromX * dx + fromY * dy) / lengthSquared),
      );
      closest = Math.min(
        closest,
        Math.hypot(fromX - fraction * dx, fromY - fraction * dy),
      );
    }
    if (closest > maximumOffsetMeters) return [];
  }
  return matched;
}

/** Insets reserve the mobile sheet while the desktop panel sits outside the map. */
export function routePadding(
  width: number,
  height: number,
  _desktop: boolean,
  bottomSheet = 0,
  rightSheet = 0,
) {
  const covered = Math.min(bottomSheet, Math.max(0, height - 100));
  const visible = Math.max(100, height - covered);
  const left = Math.min(90, width * 0.2);
  return {
    top:
      covered > 0
        ? Math.min(100, visible * 0.35)
        : Math.min(80, visible * 0.22),
    bottom: covered + Math.min(60, visible * 0.18),
    left,
    right: Math.min(
      Math.max(0, width - left - 100),
      rightSheet + Math.min(90, width * 0.2),
    ),
  };
}
