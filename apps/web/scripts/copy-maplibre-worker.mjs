/**
 * Puts MapLibre's worker where the browser can actually fetch it.
 *
 * MapLibre v6 derives its worker URL at runtime from `import.meta.url`
 * (dist/maplibre-gl.mjs, `defaultWorkerUrl`). After bundling that is a hashed
 * chunk under /_next/static/chunks/, so it asks for
 * /_next/static/chunks/maplibre-gl-worker.mjs — a path Next answers with its
 * HTML 404 page. The browser then refuses the module worker on MIME type
 * ("non-JavaScript MIME type of text/html"), nothing is left to parse tiles,
 * and every map spins forever without ever firing `load`.
 *
 * Copying rather than committing the files keeps them in lockstep with the
 * installed maplibre-gl: a vendored copy would drift silently across an
 * upgrade, and the symptom is a blank map rather than a build error.
 *
 * Node, not Bun: the Docker builder stage runs `npm run build` under Node.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The worker imports "./maplibre-gl-shared.mjs" by relative specifier, so the
// two must land in the same directory to be served side by side.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const require = createRequire(import.meta.url);
const destination = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

await mkdir(destination, { recursive: true });
for (const file of FILES) {
  await copyFile(require.resolve(`maplibre-gl/dist/${file}`), join(destination, file));
}

console.log(`maplibre worker -> public/maplibre/ (${FILES.join(", ")})`);
