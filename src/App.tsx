import { useState, useRef, useEffect, useCallback } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  UploadSimple,
  ArrowRight,
  ArrowLeft,
  ArrowsOut,
  ArrowsIn,
  HandPointing,
  HandPalm,
  ThumbsUp,
  Microphone,
  Camera,
  SpeakerHigh,
  SpeakerSlash,
  Play,
  FilePpt,
  Check,
  X,
  Image as ImageIcon,
  SpinnerGap,
  ArrowCounterClockwise,
  DownloadSimple,
  Keyboard,
  Pause,
  WarningCircle,
} from "@phosphor-icons/react";
import HandCamera from "./HandCamera";
import PdfPage from "./PdfPage";
import { useSpeech } from "./useSpeech";
import { NavigationGate, parseSpeech } from "./core.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type ImageState = {
  status: "idle" | "ready";
  topic?: string;
  url?: string;
  source?: string;
};

const Toggle = ({
  checked,
  onClick,
  label,
  disabled = false,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) => (
  <button
    className={`toggle ${checked ? "on" : ""}`}
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
  >
    <span />
  </button>
);

export default function App() {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>(null),
    [fileName, setFileName] = useState(""),
    [page, setPage] = useState(1),
    [ratio, setRatio] = useState(16 / 9);
  const [uploading, setUploading] = useState(false),
    [dragging, setDragging] = useState(false),
    [error, setError] = useState("");
  const [camera, setCamera] = useState(false),
    [paused, setPaused] = useState(false),
    [sound, setSound] = useState(true),
    [presenting, setPresenting] = useState(false);
  const [toast, setToast] = useState(""),
    [lastAction, setLastAction] = useState("準備好後，讓手與聲音接手。"),
    [source, setSource] = useState("等待操作");
  const [image, setImage] = useState<ImageState>({ status: "idle" }),
    [command, setCommand] = useState("");
  const [mousePointer, setMousePointer] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [slideSize, setSlideSize] = useState({ width: 0, height: 0 });
  const fileInput = useRef<HTMLInputElement>(null),
    localImageInput = useRef<HTMLInputElement>(null),
    app = useRef<HTMLDivElement>(null),
    pointer = useRef<HTMLDivElement>(null);
  const token = useRef(""),
    nav = useRef(new NavigationGate()),
    current = useRef({ page: 1, total: 0, paused: false, sound: true });
  current.current = { page, total: pdf?.numPages || 0, paused, sound };
  const audio = useRef<AudioContext>(null),
    toastTimer = useRef<any>(null),
    localImageUrl = useRef("");
  const pointPosition = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => {
        token.current = data.token;
      })
      .catch(() => setError("無法連上本機服務，請重新啟動。"));
  }, []);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.min(width, height * ratio);
      setSlideSize({ width: w, height: w / ratio });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [ratio]);
  function notify(text: string) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2700);
  }
  function beep() {
    if (!current.current.sound) return;
    try {
      audio.current ||= new AudioContext();
      const ac = audio.current;
      ac.resume();
      const o = ac.createOscillator(),
        g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(740, ac.currentTime);
      g.gain.setValueAtTime(0.045, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.1);
    } catch {}
  }
  const setPointer = useCallback(
    (p: { x: number; y: number } | null, smooth = true) => {
      const el = pointer.current;
      if (!el) return;
      if (!p) {
        el.style.opacity = "0";
        pointPosition.current = null;
        return;
      }
      const old = pointPosition.current;
      const next =
        old && smooth
          ? { x: old.x + (p.x - old.x) * 0.35, y: old.y + (p.y - old.y) * 0.35 }
          : p;
      pointPosition.current = next;
      el.style.left = next.x * 100 + "%";
      el.style.top = next.y * 100 + "%";
      el.style.opacity = "1";
    },
    [],
  );
  function navigate(direction: number, origin: string) {
    const c = current.current;
    if (!c.total) return;
    const result = nav.current.navigate(
      c.page,
      c.total,
      direction,
      performance.now(),
    );
    if (!result.changed) {
      if (result.reason === "boundary")
        notify(direction > 0 ? "已經是最後一頁" : "已經是第一頁");
      return;
    }
    current.current.page = result.page;
    setPage(result.page);
    setSource(origin);
    setLastAction(
      `${direction > 0 ? "下一頁" : "上一頁"} → 第 ${result.page} 頁`,
    );
    beep();
    notify(`${origin} · 第 ${result.page} 頁`);
  }
  function changePaused(value: boolean, origin: string) {
    setPaused(value);
    current.current.paused = value;
    setPointer(null);
    setSource(origin);
    setLastAction(value ? "手勢已暫停，語音仍可使用" : "手勢已恢復");
    notify(value ? "手勢已暫停 · 語音仍可使用" : "手勢已恢復");
  }
  function handleGesture(action: string) {
    if (!current.current.total) return;
    if (action === "next" || action === "previous")
      navigate(action === "next" ? 1 : -1, "手勢");
  }
  function cancelImage() {
    setImage({ status: "idle" });
  }
  function handleSpeech(action: any, origin = "語音") {
    if (action.type === "dismiss") {
      cancelImage();
      notify("已回到簡報");
      return;
    }
    if (action.type === "pause" || action.type === "resume") {
      changePaused(action.type === "pause", origin);
      return;
    }
    if (action.type === "next" || action.type === "previous") {
      navigate(action.type === "next" ? 1 : -1, origin);
      return;
    }
  }
  const speech = useSpeech(handleSpeech);
  async function loadFile(file: File) {
    if (uploading) return;
    if (!/\.(pptx?|pdf)$/i.test(file.name)) {
      setError("請選擇 .pptx、.ppt 或 .pdf 檔案。");
      return;
    }
    if (file.size > 60 * 1024 * 1024) {
      setError("檔案大小上限為 60 MB。");
      return;
    }
    setUploading(true);
    setError("");
    setPointer(null);
    await cancelImage();
    try {
      if (!token.current) {
        const r = await fetch("/api/status");
        token.current = (await r.json()).token;
      }
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "X-SlideSense-Token": token.current },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const task = pdfjs.getDocument({ url: data.url });
      task.onPassword = () => {
        task.destroy();
        setError("此 PDF 受密碼保護，請先移除密碼再上傳。");
      };
      const document = await task.promise;
      if (document.numPages > 200) {
        await task.destroy();
        throw new Error("此版本最多播放 200 頁簡報。");
      }
      setPdf(document);
      setFileName(data.name);
      setPage(1);
      current.current.page = 1;
      nav.current = new NavigationGate();
      setLastAction("簡報已就緒，按「開始放映」");
      setSource("已載入");
      notify(`已載入 ${document.numPages} 頁`);
    } catch (e) {
      setError((e as Error).message || "無法載入簡報，請重試。");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function loadDemo() {
    try {
      const r = await fetch("/demo/SlideSense-demo.pptx");
      if (!r.ok) throw new Error();
      await loadFile(new File([await r.blob()], "SlideSense-demo.pptx"));
    } catch {
      setError("範例簡報載入失敗，請先上傳自己的 PPT。");
    }
  }
  async function fullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    try {
      await app.current.requestFullscreen();
      setPresenting(true);
    } catch {
      setPresenting((v) => !v);
    }
  }
  useEffect(() => {
    const update = () => setPresenting(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const keyboard = useRef<any>(null);
  keyboard.current = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input,textarea,select")) return;
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      navigate(1, "鍵盤");
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(-1, "鍵盤");
    }
    if (event.key === "Escape") {
      cancelImage();
      setPresenting(false);
    }
    if (event.key.toLowerCase() === "f" && pdf) fullscreen();
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keyboard.current?.(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      if (localImageUrl.current) URL.revokeObjectURL(localImageUrl.current);
      audio.current?.close();
    },
    [],
  );
  function showLocalImage(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      notify("請選擇 PNG、JPG 或 WebP 圖片");
      return;
    }
    cancelImage();
    if (localImageUrl.current) URL.revokeObjectURL(localImageUrl.current);
    localImageUrl.current = URL.createObjectURL(file);
    setImage({
      status: "ready",
      topic: file.name,
      url: localImageUrl.current,
      source: "本機圖片",
    });
  }

  return (
    <div ref={app} className={`app ${presenting ? "presenting" : ""}`}>
      <header className="topbar">
        <a href="/" className="brand" aria-label="SlideSense 首頁">
          <span className="brand-mark">
            <HandPointing size={23} weight="fill" />
          </span>
          SlideSense<span className="brand-caption">簡報，交給手與聲音</span>
        </a>
        <div className="header-actions">
          <span className="header-note">PPT × 手勢 × 語音</span>
          {pdf && (
            <button className="primary" onClick={fullscreen}>
              <Play size={17} weight="fill" />
              開始放映
            </button>
          )}
        </div>
      </header>
      <main className="workspace">
        <section className="presentation-area">
          <div className="deck-header">
            <div>
              <span className="section-label">YOUR STAGE</span>
              <h1>{pdf ? fileName : "把簡報放上來，開始說故事。"}</h1>
            </div>
            {pdf && (
              <button
                className="quiet small"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                <UploadSimple size={17} />
                更換簡報
              </button>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <WarningCircle size={19} />
              <span>{error}</span>
              <button aria-label="關閉錯誤" onClick={() => setError("")}>
                <X />
              </button>
            </div>
          )}
          <div ref={stage} className={`stage ${!pdf ? "empty-stage" : ""}`}>
            {pdf ? (
              <div
                className="slide-surface"
                style={{
                  width: slideSize.width || "100%",
                  height: slideSize.height || "auto",
                }}
                onMouseMove={(e) => {
                  if (mousePointer) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPointer(
                      {
                        x: (e.clientX - r.left) / r.width,
                        y: (e.clientY - r.top) / r.height,
                      },
                      false,
                    );
                  }
                }}
                onMouseLeave={() => {
                  if (mousePointer) setPointer(null);
                }}
              >
                <PdfPage pdf={pdf} page={page} onReady={setRatio} />
                {image.status === "ready" && (
                  <div className="image-overlay">
                    <img src={image.url} alt={image.topic} />
                    <div className="image-caption">
                      <span>
                        {image.source} · {image.topic}
                      </span>
                      <button onClick={() => cancelImage()}>
                        <ArrowCounterClockwise size={17} />
                        回到簡報
                      </button>
                    </div>
                  </div>
                )}
                <div
                  ref={pointer}
                  className="laser-pointer"
                  data-testid="laser-pointer"
                />
              </div>
            ) : (
              <div
                className={`upload-zone ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files[0])
                    loadFile(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-illustration">
                  <FilePpt size={72} weight="duotone" />
                  <div className="illustration-pointer" />
                  <span className="mini-slide">01</span>
                </div>
                <h2>你的 PPT，新的操作方式。</h2>
                <p>
                  上傳簡報，用手翻頁、指重點，
                  <br />
                  讓觀眾跟上你的每個重點。
                </p>
                <button
                  className="primary upload-button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                >
                  <UploadSimple size={19} />
                  上傳簡報
                </button>
                <span className="upload-meta">
                  PPTX、PPT 或 PDF · 最大 60 MB
                </span>
                <button
                  className="text-button"
                  onClick={loadDemo}
                  disabled={uploading}
                >
                  先試試五頁範例 <ArrowRight size={15} />
                </button>
              </div>
            )}
            {uploading && (
              <div className="loading-overlay" role="status">
                <SpinnerGap size={34} className="spin" />
                <strong>正在準備你的投影片</strong>
                <span>轉換與載入中，請稍候…</span>
              </div>
            )}
            {toast && (
              <div className="toast" role="status">
                <Check size={17} />
                {toast}
              </div>
            )}
          </div>
          {pdf ? (
            <>
              <div className="playback-bar">
                <div className="page-controls">
                  <button
                    className="icon-button"
                    aria-label="上一頁"
                    disabled={page === 1}
                    onClick={() => navigate(-1, "按鈕")}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <span>
                    <b>{String(page).padStart(2, "0")}</b>
                    <i>/</i>
                    {String(pdf.numPages).padStart(2, "0")}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="下一頁"
                    disabled={page === pdf.numPages}
                    onClick={() => navigate(1, "按鈕")}
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
                <div className="playback-status">
                  <span
                    className={`status-dot ${camera && !paused ? "active" : ""}`}
                  />
                  {camera ? (paused ? "手勢暫停" : "手勢已開啟") : "手勢未開啟"}
                  <span
                    className={`status-dot ${speech.active ? "active" : ""}`}
                  />
                  {speech.active ? "語音聆聽中" : "語音未開啟"}
                </div>
                <div className="playback-tools">
                  <button
                    className={`icon-button ${mousePointer ? "selected" : ""}`}
                    aria-label="滑鼠指示模式"
                    title="滑鼠指示模式（手動操作）"
                    onClick={() => {
                      setMousePointer(!mousePointer);
                      setPointer(null);
                    }}
                  >
                    <HandPointing size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={sound ? "關閉音效" : "開啟音效"}
                    onClick={() => setSound(!sound)}
                  >
                    {sound ? (
                      <SpeakerHigh size={20} />
                    ) : (
                      <SpeakerSlash size={20} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={presenting ? "離開放映" : "全螢幕放映"}
                    onClick={fullscreen}
                  >
                    {presenting ? (
                      <ArrowsIn size={20} />
                    ) : (
                      <ArrowsOut size={20} />
                    )}
                  </button>
                </div>
              </div>
              <div className="filmstrip" aria-label="投影片縮圖">
                {Array.from({ length: pdf.numPages }, (_, i) => (
                  <button
                    key={i}
                    className={`thumbnail ${page === i + 1 ? "current" : ""}`}
                    aria-label={`前往第 ${i + 1} 頁`}
                    onClick={() => {
                      setPage(i + 1);
                      current.current.page = i + 1;
                      nav.current = new NavigationGate();
                    }}
                  >
                    <PdfPage pdf={pdf} page={i + 1} thumbnail />
                    <span>{String(i + 1).padStart(2, "0")}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="feature-strip">
              <span>
                <HandPalm size={22} />
                比讚換頁
              </span>
              <span>
                <HandPointing size={22} />
                食指指示
              </span>
              <span>
                <Microphone size={22} />
                語音控制
              </span>
              <span>
                <ArrowsOut size={22} />
                全螢幕放映
              </span>
            </div>
          )}
          <p className="format-note">
            PPT
            會轉為靜態頁面播放；逐項動畫、轉場與內嵌影片不會保留。簡報在本機轉換。
          </p>
        </section>
        <aside className="control-panel">
          <div className="panel-heading">
            <h2>你的簡報助教</h2>
            <span className="local-tag">本機工具</span>
          </div>
          <div className="control-heading">
            <span>
              <Camera size={19} />
              手勢與指示
            </span>
            <Toggle
              checked={camera}
              label="啟用攝影機"
              onClick={() => setCamera(!camera)}
            />
          </div>
          <HandCamera
            enabled={camera}
            paused={paused}
            onAction={handleGesture}
            onPointer={(p) => {
              if (!mousePointer) setPointer(p);
            }}
            onError={notify}
          />
          <div className="gesture-help">
            <span>
              <ThumbsUp size={18} />
              <b>比讚／倒讚</b>
              <small>下一頁／上一頁</small>
            </span>
            <span>
              <HandPointing size={18} />
              <b>只伸食指</b>
              <small>移動亮點</small>
            </span>
          </div>
          {camera && (
            <button
              className="pause-button"
              onClick={() => changePaused(!paused, "按鈕")}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}{" "}
              {paused ? "恢復手勢控制" : "暫停手勢控制"}
              <span>語音保持可用</span>
            </button>
          )}
          <div className="panel-divider" />
          <div className="control-heading">
            <span>
              <Microphone size={19} />
              語音控制
            </span>
            <Toggle
              checked={speech.active || speech.starting}
              label="啟用語音"
              onClick={() =>
                speech.active || speech.starting
                  ? speech.stop()
                  : speech.start()
              }
            />
          </div>
          <div className="voice-box">
            <div className={`voice-meter ${speech.active ? "listening" : ""}`}>
              {Array.from({ length: 28 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    height: Math.max(
                      3,
                      speech.level * 26 * (0.35 + Math.sin(i * 1.8) ** 2),
                    ),
                  }}
                />
              ))}
            </div>
            <p>
              {speech.error ||
                speech.transcript ||
                (speech.starting
                  ? "正在連接麥克風…"
                  : speech.active
                    ? "正在聆聽，試著說「下一頁」"
                    : "開啟麥克風，隨時用嘴接手。")}
            </p>
          </div>
          <div className="voice-examples">
            <span>「下一頁」</span>
            <span>「上一頁」</span>
            <span>「簡報，繼續」</span>
            <span>「回到簡報」</span>
          </div>
          <div className="panel-divider" />
          <div className="control-heading">
            <span>
              <ImageIcon size={19} />
              補充圖片
            </span>
          </div>
          <p className="helper-text">
            需要補充說明時，可以展示電腦裡的圖片，再說「回到簡報」繼續。
          </p>
          <button
            className="local-image-button"
            onClick={() => localImageInput.current?.click()}
            disabled={!pdf}
          >
            <UploadSimple size={16} />
            選擇本機圖片
          </button>
          <div className="activity">
            <span>{source}</span>
            <p>{lastAction}</p>
          </div>
          <details className="command-test">
            <summary>
              <Keyboard size={16} />
              口令測試
            </summary>
            <p>以文字測試指令流程；不代表麥克風辨識結果。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const action = parseSpeech(command);
                if (action) {
                  handleSpeech(action, "文字口令");
                  notify("文字口令已執行");
                } else notify("未辨識為指令，請使用上方範例");
              }}
            >
              <input
                aria-label="測試口令"
                placeholder="下一頁"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <button type="submit" aria-label="執行文字口令">
                <ArrowRight size={18} />
              </button>
            </form>
          </details>
        </aside>
      </main>
      <footer className="app-footer">
        <span>SlideSense</span>
        <span>手勢與語音可以混用 · 換頁後短暫冷卻，避免連跳</span>
        <a href="/demo/SlideSense-demo.pptx" download>
          <DownloadSimple size={14} />
          下載範例 PPT
        </a>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept=".ppt,.pptx,.pdf"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) loadFile(e.target.files[0]);
        }}
      />
      <input
        ref={localImageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) showLocalImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
