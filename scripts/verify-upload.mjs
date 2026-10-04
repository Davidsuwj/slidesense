import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const base = process.env.SLIDESENSE_URL || "http://127.0.0.1:4317";
const status = await fetch(base + "/api/status").then((r) => r.json());
let r = await fetch(base + "/api/upload", { method: "POST" });
assert.equal(r.status, 403);
r = await fetch(base + "/api/status", {
  headers: { Origin: "https://untrusted.example" },
});
assert.equal(r.status, 403);
const invalid = new FormData();
invalid.append("file", new Blob(["not a PowerPoint file"]), "fake.pptx");
r = await fetch(base + "/api/upload", {
  method: "POST",
  headers: { "X-SlideSense-Token": status.token },
  body: invalid,
});
assert.equal(r.status, 400);
const form = new FormData();
form.append(
  "file",
  new Blob([
    await readFile(
      new URL("../public/demo/SlideSense-demo.pptx", import.meta.url),
    ),
  ]),
  "範例簡報.pptx",
);
r = await fetch(base + "/api/upload", {
  method: "POST",
  headers: { "X-SlideSense-Token": status.token },
  body: form,
});
const data = await r.json();
assert.equal(r.status, 200, data.error);
assert.equal(data.name, "範例簡報.pptx");
const pdf = Buffer.from(
  await fetch(base + data.url).then((r) => r.arrayBuffer()),
);
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
assert.ok(pdf.length > 1000);
await mkdir(new URL("../.slidesense/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../.slidesense/upload-check.pdf", import.meta.url),
  pdf,
);
console.log(
  "PASS: PPTX upload, Chinese filename, PDF download, invalid file rejection, origin check and session token.",
);
