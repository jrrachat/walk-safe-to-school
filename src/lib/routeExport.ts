import { LngLatBounds, type Map as RouteMap } from "maplibre-gl";
import type { Place } from "../../shared/demo";
import type { Route } from "../../shared/routing";

export type ExportFormat = "png" | "pdf";
export function routeFilename(name: string) {
  return (
    "walk-to-" +
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "school")
  );
}
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let short = text;
  while (short.length && ctx.measureText(short + "\u2026").width > width)
    short = short.slice(0, -1);
  return short + "\u2026";
}

// Reuse the existing map renderer and its style. Temporarily fit the entire
// route north-up, then restore the parent's previous view after capture.
export async function renderRouteCard(
  map: RouteMap,
  route: Route,
  start: Place,
  end: Place,
) {
  if (route.coordinates.length < 2 || !map.getStyle())
    throw new Error(
      "Wait for the walking route and map to finish loading, then try again.",
    );
  const camera = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    padding: map.getPadding(),
  };
  const container = map.getContainer();
  const originalSize = {
    width: container.style.width,
    height: container.style.height,
  };
  const bounds = new LngLatBounds();
  route.coordinates.forEach((coordinate) => bounds.extend(coordinate));
  const width = 1600,
    header = 200,
    footer = 60;
  try {
    container.style.width = "1200px";
    container.style.height = "850px";
    map.resize();
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(
          new Error(
            "The map could not finish loading. Check your connection and try again.",
          ),
        );
      };
      const timeout = window.setTimeout(failed, 20000);
      const cleanup = () => {
        clearTimeout(timeout);
        map.off("idle", done);
        map.off("error", failed);
      };
      map.on("idle", done);
      map.on("error", failed);
      map.fitBounds(bounds, {
        padding: 60,
        bearing: 0,
        pitch: 0,
        maxZoom: 17,
        duration: 0,
      });
      map.triggerRepaint();
    });
    const source = map.getCanvas();
    const height = Math.round(
      (width * source.clientHeight) / source.clientWidth,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = header + height + footer;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot create a route image.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.drawImage(source, 0, header, width, height);
    const scale = width / source.clientWidth;
    // HTML markers are outside the WebGL canvas; add clear endpoint labels.
    for (const [coordinate, label, color] of [
      [route.coordinates[0], "A", "#177345"],
      [route.coordinates[route.coordinates.length - 1], "B", "#823ca2"],
    ] as const) {
      const point = map.project(coordinate);
      const x = point.x * scale,
        y = header + point.y * scale;
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.font = "bold 28px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 27px Arial";
    ctx.fillStyle = "#177345";
    ctx.fillText(fitText(ctx, "A  Start: " + start.name, 1220), 48, 62);
    ctx.fillStyle = "#823ca2";
    ctx.fillText(fitText(ctx, "B  School: " + end.name, 1220), 48, 103);
    ctx.fillStyle = "#435367";
    ctx.font = "24px Arial";
    ctx.fillText(
      route.minutes +
        " min  |  " +
        (route.meters / 1609.344).toFixed(2) +
        " mi",
      48,
      147,
    );
    // Compass stays outside the map so it never covers a street or the route.
    ctx.save();
    ctx.translate(1440, 100);
    ctx.strokeStyle = "#c9d4df";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#1261d8";
    ctx.beginPath();
    ctx.moveTo(0, -43);
    ctx.lineTo(-13, 17);
    ctx.lineTo(0, 7);
    ctx.lineTo(13, 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#172b40";
    ctx.font = "bold 25px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 0, -72);
    ctx.fillText("S", 0, 73);
    ctx.fillText("W", -77, 0);
    ctx.fillText("E", 77, 0);
    ctx.restore();
    ctx.fillStyle = "#435367";
    const bottom = header + height;
    ctx.font = "18px Arial";
    // Preserve attribution from the actual map, including custom providers.
    const credits = document.createElement("div");
    credits.innerHTML = Object.values(map.getStyle().sources)
      .map((s) => ("attribution" in s ? s.attribution || "" : ""))
      .filter(Boolean)
      .join(" | ");
    ctx.fillText(
      fitText(
        ctx,
        credits.textContent || "Map data (c) OpenStreetMap contributors",
        width - 96,
      ),
      48,
      bottom + 36,
    );
    return canvas;
  } finally {
    container.style.width = originalSize.width;
    container.style.height = originalSize.height;
    map.resize();
    map.jumpTo(camera);
  }
}

export async function downloadRoute(
  format: ExportFormat,
  map: RouteMap,
  route: Route,
  start: Place,
  end: Place,
) {
  const canvas = await renderRouteCard(map, route, start, end);
  const filename = routeFilename(end.name);
  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    const pageWidth = pdf.internal.pageSize.getWidth(),
      pageHeight = pdf.internal.pageSize.getHeight();
    const scale = Math.min(
      (pageWidth - 16) / canvas.width,
      (pageHeight - 16) / canvas.height,
    );
    const width = canvas.width * scale,
      height = canvas.height * scale;
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      (pageWidth - width) / 2,
      (pageHeight - height) / 2,
      width,
      height,
    );
    pdf.save(filename + ".pdf");
    return;
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(
              new Error("Could not create the route image. Please try again."),
            ),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename + ".png";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
