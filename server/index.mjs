import express from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = promisify(execFile);
const app = express();
const port = Number(process.env.PORT || 4317);
const token = randomBytes(24).toString("hex");
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "slidesense-"));
const bundledSoffice = path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice",
);
const soffice =
  process.env.SOFFICE_PATH ||
  (existsSync(bundledSoffice) ? bundledSoffice : "soffice");
// Bundled headless LibreOffice needs explicit macOS font directories.
// Keep its installation untouched; use a process-local Fontconfig file.
const conversionEnv = { ...process.env };
if (process.platform === "darwin" && !process.env.FONTCONFIG_FILE) {
  const dirs = [
    "/System/Library/Fonts",
    "/Library/Fonts",
    path.join(os.homedir(), "Library/Fonts"),
  ];
  const assetRoot = "/System/Library/AssetsV2";
  const assetTypes = await fs.readdir(assetRoot).catch(() => []);
  for (const name of assetTypes.filter((n) =>
    n.startsWith("com_apple_MobileAsset_Font"),
  ))
    dirs.push(path.join(assetRoot, name));
  const xml = (s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const config = path.join(dataDir, "fonts.conf");
  await fs.writeFile(
    config,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>${dirs.map((d) => `<dir>${xml(d)}</dir>`).join("")}<cachedir>${xml(path.join(dataDir, "font-cache"))}</cachedir><alias><family>sans-serif</family><prefer><family>Arial</family><family>PingFang TC</family></prefer></alias></fontconfig>`,
  );
  conversionEnv.FONTCONFIG_FILE = config;
}
let converting = false;
const files = new Map();
const upload = multer({
  dest: dataDir,
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host || "";
  if (!["127.0.0.1:" + port, "localhost:" + port].includes(host))
    return res.status(403).json({ error: "僅供本機使用。" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)
  )
    return res.status(403).json({ error: "來源不符。" });
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "來源不符。" });
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.headers["x-slidesense-token"] !== token)
    return res.status(403).json({ error: "工作階段已失效，請重新整理。" });
  next();
});
app.use(express.json({ limit: "16kb" }));
app.get("/api/status", (req, res) =>
  res.json({
    token,
    converter: existsSync(soffice) ? "ready" : "check-on-upload",
  }),
);
app.post("/api/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file)
    return res.status(400).json({ error: "請選擇 PPT、PPTX 或 PDF 檔。" });
  let work;
  let ownsConversion = false;
  try {
    if (converting)
      return res
        .status(409)
        .json({ error: "另一份簡報正在轉換，請稍後重試。" });
    let name = file.originalname;
    // Multipart filenames arrive as latin1 with some browsers.
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    if (!decoded.includes("\ufffd")) name = decoded;
    const ext = path.extname(name).toLowerCase();
    if (![".ppt", ".pptx", ".pdf"].includes(ext))
      return res
        .status(400)
        .json({ error: "支援 .pptx、.ppt 與 .pdf，請重新選擇。" });
    const fh = await fs.open(file.path, "r");
    const head = Buffer.alloc(8);
    await fh.read(head, 0, 8, 0);
    await fh.close();
    const valid =
      ext === ".pdf"
        ? head.subarray(0, 5).toString() === "%PDF-"
        : ext === ".pptx"
          ? head[0] === 0x50 && head[1] === 0x4b
          : head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    if (!valid)
      return res
        .status(400)
        .json({ error: "檔案內容與副檔名不符，請使用有效的簡報檔。" });
    converting = true;
    ownsConversion = true;
    const id = randomUUID();
    work = path.join(dataDir, id);
    await fs.mkdir(work);
    const source = path.join(work, "presentation" + ext);
    await fs.rename(file.path, source);
    const output = path.join(work, "presentation.pdf");
    if (ext !== ".pdf") {
      await run(
        soffice,
        [
          "--headless",
          "--convert-to",
          "pdf:impress_pdf_Export",
          "--outdir",
          work,
          source,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024, env: conversionEnv },
      );
    }
    const info = await fs.stat(output);
    if (info.size === 0) throw new Error("EMPTY");
    files.set(id, output);
    res.json({ id, name, url: `/api/decks/${id}`, converted: ext !== ".pdf" });
  } catch (error) {
    if (work) await fs.rm(work, { recursive: true, force: true });
    const msg =
      error.code === "ENOENT"
        ? "找不到簡報轉換工具。請設定 SOFFICE_PATH，或先上傳 PDF。"
        : error.killed
          ? "轉換超過兩分鐘。請縮小簡報或改用 PDF。"
          : "無法轉換這份簡報。請確認檔案沒有密碼、能正常開啟，或改用 PDF。";
    res.status(422).json({ error: msg });
  } finally {
    if (ownsConversion) converting = false;
    await fs.rm(file.path, { force: true }).catch(() => {});
  }
});
app.get("/api/decks/:id", (req, res) => {
  const file = files.get(req.params.id);
  if (!file) return res.status(404).json({ error: "簡報已過期，請重新上傳。" });
  res.type("pdf").sendFile(file);
});
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "檔案上限為 60 MB。"
          : "一次只能上傳一份簡報。",
    });
  if (err instanceof SyntaxError)
    return res.status(400).json({ error: "請求格式不正確。" });
  res.status(500).json({ error: "服務暫時無法處理，請重試。" });
});
const server = createHttpServer(app);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true, ws: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.listen(port, "127.0.0.1", () =>
  console.log(`SlideSense ready: http://127.0.0.1:${port}`),
);
async function shutdown() {
  server.close();
  await fs.rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
