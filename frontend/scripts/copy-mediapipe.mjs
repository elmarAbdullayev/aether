// Copies the MediaPipe WebAssembly files next to the site, so the version always matches the npm package.
// File by file on purpose: fs.cpSync crashes on Windows paths with non-ASCII letters (like "Masaüstü").
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "mediapipe");

if (!existsSync(from)) {
  console.error("MediaPipe is missing. Run npm install first.");
  process.exit(1);
}
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) copyFileSync(join(from, name), join(to, name));
