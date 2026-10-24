import { performance } from "node:perf_hooks";

const base = process.argv[2] || "http://127.0.0.1:3001";
const samples = [];
const failures = [];

async function batch(label, count, concurrency, path, init, expectedStatus) {
  for (let offset = 0; offset < count; offset += concurrency) {
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, count - offset) },
        async () => {
          const start = performance.now();
          try {
            const response = await fetch(base + path, init);
            await response.arrayBuffer();
            samples.push({ label, ms: performance.now() - start });
            if (response.status !== expectedStatus)
              failures.push(`${label}: HTTP ${response.status}`);
          } catch (error) {
            failures.push(`${label}: ${error}`);
          }
        },
      ),
    );
  }
}

await batch("health", 500, 50, "/api/health", undefined, 200);
await batch(
  "invalid route",
  200,
  50,
  "/api/routes",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start: [999, 999] }),
  },
  400,
);
await batch(
  "oversized body",
  20,
  10,
  "/api/routes",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(40_000) }),
  },
  400,
);

for (const label of ["health", "invalid route", "oversized body"]) {
  const sorted = samples
    .filter((sample) => sample.label === label)
    .map((sample) => sample.ms)
    .sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]?.toFixed(0);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]?.toFixed(0);
  console.log(
    `${label}: ${sorted.length} requests, p50 ${p50} ms, p95 ${p95} ms`,
  );
}
if (failures.length) {
  console.error(failures.slice(0, 10).join("\n"));
  process.exitCode = 1;
}
