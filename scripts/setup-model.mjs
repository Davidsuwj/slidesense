import { mkdir, copyFile, access, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await mkdir(path.join(root, "public/wasm"), { recursive: true });
await mkdir(path.join(root, "public/models"), { recursive: true });
for (const name of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  await copyFile(
    path.join(root, "node_modules/@mediapipe/tasks-vision/wasm", name),
    path.join(root, "public/wasm", name),
  );
}
const target = path.join(root, "public/models/hand_landmarker.task");
try {
  await access(target);
  console.log("Hand model ready.");
} catch {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  );
  if (!response.ok)
    throw new Error("Hand model download failed: " + response.status);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.log("Hand model downloaded.");
}
