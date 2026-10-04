import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import { Camera, HandPalm, WarningCircle } from "@phosphor-icons/react";
import { GestureTracker } from "./core.mjs";

export default function HandCamera({
  enabled,
  paused,
  onAction,
  onPointer,
  onError,
}: {
  enabled: boolean;
  paused: boolean;
  onAction: (action: string) => void;
  onPointer: (p: { x: number; y: number } | null) => void;
  onError: (s: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const handlers = useRef({ paused, onAction, onPointer, onError });
  handlers.current = { paused, onAction, onPointer, onError };
  const [status, setStatus] = useState("攝影機尚未開啟");
  const [error, setError] = useState("");
  const [pose, setPose] = useState("等待手勢");
  useEffect(() => {
    let disposed = false,
      stream: MediaStream,
      model: HandLandmarker,
      frame = 0;
    const tracker = new GestureTracker();
    let lastFrame = 0,
      lastUI = 0,
      lastVideo = -1;
    if (!enabled) {
      setStatus("攝影機尚未開啟");
      setError("");
      handlers.current.onPointer(null);
      return;
    }
    async function start() {
      try {
        setError("");
        setStatus("正在開啟攝影機…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current!.srcObject = stream;
        await video.current!.play();
        setStatus("正在載入手部辨識…");
        const files = await FilesetResolver.forVisionTasks("/wasm");
        const options = {
          baseOptions: { modelAssetPath: "/models/hand_landmarker.task" },
          runningMode: "VIDEO" as const,
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        };
        try {
          model = await HandLandmarker.createFromOptions(files, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: "GPU" },
          });
        } catch {
          model = await HandLandmarker.createFromOptions(files, options);
        }
        if (disposed) {
          model.close();
          return;
        }
        setStatus("攝影機已連接");
        const draw = new DrawingUtils(canvas.current!.getContext("2d")!);
        function tick(now: number) {
          if (disposed) return;
          frame = requestAnimationFrame(tick);
          const v = video.current,
            c = canvas.current;
          if (
            !v ||
            !c ||
            v.readyState < 2 ||
            now - lastFrame < 50 ||
            v.currentTime === lastVideo
          )
            return;
          lastFrame = now;
          lastVideo = v.currentTime;
          try {
            const result = model.detectForVideo(v, now);
            const ctx = c.getContext("2d")!;
            ctx.clearRect(0, 0, c.width, c.height);
            const points = result.landmarks[0];
            if (points) {
              draw.drawConnectors(points, HandLandmarker.HAND_CONNECTIONS, {
                color: "#b9f481",
                lineWidth: 2,
              });
              draw.drawLandmarks(points, {
                color: "#ffffff",
                radius: 2,
                lineWidth: 1,
              });
            }
            const state = tracker.update(points, now, handlers.current.paused);
            handlers.current.onPointer(state.pointer);
            if (state.action) handlers.current.onAction(state.action);
            if (now - lastUI > 180) {
              lastUI = now;
              setPose(
                handlers.current.paused
                  ? "手勢已暫停"
                  : {
                      point: "食指指示",
                      palm: "張開手掌",
                      none: "等待手勢",
                      other: "辨識中",
                    }[state.kind],
              );
            }
          } catch {
            setError("手部辨識中斷，請關閉後重新開啟。");
            handlers.current.onPointer(null);
            cancelAnimationFrame(frame);
          }
        }
        frame = requestAnimationFrame(tick);
      } catch (e) {
        if (disposed) return;
        stream?.getTracks().forEach((t) => t.stop());
        const message =
          (e as Error).name === "NotAllowedError"
            ? "請允許攝影機權限後再試。"
            : (e as Error).name === "NotFoundError"
              ? "找不到攝影機，請確認裝置已連接。"
              : "無法啟動攝影機或辨識模型，請關閉後重試。";
        setError(message);
        handlers.current.onError(message);
      }
    }
    start();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      model?.close();
      handlers.current.onPointer(null);
    };
  }, [enabled]);
  return (
    <div className="camera-block">
      <div className="camera-feed">
        <video
          ref={video}
          muted
          playsInline
          className={enabled && !error ? "" : "invisible"}
        />
        <canvas ref={canvas} width={640} height={480} />
        {(!enabled || error) && (
          <div className="camera-empty">
            {error ? <WarningCircle size={30} /> : <Camera size={34} />}
            <span>{error || "開啟攝影機，讓手勢接手"}</span>
          </div>
        )}
        {enabled && !error && (
          <span className="camera-label">
            <span className="live-dot" />
            {status}
          </span>
        )}
      </div>
      <div className="pose-line">
        <HandPalm size={17} />
        <span>{enabled ? pose : "右揮翻頁 · 食指指示"}</span>
      </div>
    </div>
  );
}
