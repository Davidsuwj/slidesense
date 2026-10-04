import { useRef, useState, useEffect } from "react";
import { parseSpeech } from "./core.mjs";

export function useSpeech(onCommand: (command: any) => void) {
  const callback = useRef(onCommand);
  callback.current = onCommand;
  const recognition = useRef<any>(null),
    wanted = useRef(false),
    stream = useRef<MediaStream>(null),
    context = useRef<AudioContext>(null),
    animation = useRef(0),
    retry = useRef<any>(null);
  const [active, setActive] = useState(false),
    [transcript, setTranscript] = useState(""),
    [error, setError] = useState(""),
    [level, setLevel] = useState(0),
    [starting, setStarting] = useState(false);
  const supported = !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
  function stop() {
    wanted.current = false;
    clearTimeout(retry.current);
    recognition.current?.abort();
    recognition.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    cancelAnimationFrame(animation.current);
    context.current?.close().catch(() => {});
    context.current = null;
    setActive(false);
    setStarting(false);
    setLevel(0);
  }
  async function start() {
    if (wanted.current) return;
    if (!supported) {
      setError("此瀏覽器不支援語音辨識，請用 Chrome 開啟。");
      return;
    }
    wanted.current = true;
    setError("");
    setStarting(true);
    try {
      const audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!wanted.current) {
        audio.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = audio;
      const ac = new AudioContext();
      context.current = ac;
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(audio).connect(analyser);
      const bytes = new Uint8Array(analyser.frequencyBinCount);
      let last = 0;
      function meter(now: number) {
        if (!wanted.current) return;
        animation.current = requestAnimationFrame(meter);
        if (now - last < 100) return;
        last = now;
        analyser.getByteFrequencyData(bytes);
        setLevel(
          Math.min(1, bytes.reduce((a, b) => a + b, 0) / bytes.length / 65),
        );
      }
      animation.current = requestAnimationFrame(meter);
      const Constructor =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      const r = new Constructor();
      recognition.current = r;
      r.lang = "zh-TW";
      r.continuous = true;
      r.interimResults = true;
      r.onstart = () => {
        setActive(true);
        setStarting(false);
        setError("");
      };
      r.onresult = (event: any) => {
        let text = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          text += result[0].transcript;
          if (result.isFinal) {
            const command = parseSpeech(result[0].transcript);
            if (command) callback.current(command);
          }
        }
        setTranscript(text);
      };
      r.onerror = (event: any) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        const messages = {
          "not-allowed": "請允許麥克風與語音辨識權限。",
          "audio-capture": "無法取得麥克風，請檢查裝置。",
          network: "語音服務連線失敗，請確認網路後重新啟用。",
          "service-not-allowed": "此瀏覽器無法使用語音服務，請改用 Chrome。",
        };
        setError(messages[event.error] || "語音辨識已中斷，請重新啟用。");
        stop();
      };
      r.onend = () => {
        if (wanted.current) {
          setActive(false);
          retry.current = setTimeout(() => {
            if (wanted.current)
              try {
                r.start();
              } catch {
                setError("語音服務已停止，請重新啟用。");
                stop();
              }
          }, 500);
        }
      };
      r.start();
    } catch (e) {
      setError(
        (e as Error).name === "NotAllowedError"
          ? "請允許麥克風權限後再試。"
          : "無法啟動麥克風，請確認裝置與瀏覽器。",
      );
      stop();
    }
  }
  useEffect(() => () => stop(), []);
  return { active, starting, transcript, error, level, supported, start, stop };
}
