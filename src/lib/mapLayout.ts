/** Insets reserve the mobile sheet while the desktop panel sits outside the map. */
export function routePadding(
  width: number,
  height: number,
  _desktop: boolean,
  bottomSheet = 0,
) {
  const covered = Math.min(bottomSheet, Math.max(0, height - 100));
  const visible = Math.max(100, height - covered);
  return {
    top: Math.min(80, visible * 0.22),
    bottom: covered + Math.min(60, visible * 0.18),
    left: Math.min(90, width * 0.2),
    right: Math.min(90, width * 0.2),
  };
}
