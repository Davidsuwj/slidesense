import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
export default function PdfPage({
  pdf,
  page,
  thumbnail = false,
  onReady,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  thumbnail?: boolean;
  onReady?: (ratio: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const callback = useRef(onReady);
  callback.current = onReady;
  useEffect(() => {
    let cancelled = false,
      task: any;
    async function draw() {
      try {
        const p = await pdf.getPage(page);
        if (cancelled) return;
        const basic = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({
          scale: (thumbnail ? 280 : 1920) / basic.width,
        });
        const c = canvas.current;
        if (!c) return;
        c.width = viewport.width;
        c.height = viewport.height;
        task = p.render({ canvas: c, viewport });
        await task.promise;
        if (!cancelled) callback.current?.(basic.width / basic.height);
      } catch (e) {
        if (!cancelled && (e as Error).name !== "RenderingCancelledException")
          console.error("Slide render failed");
      }
    }
    draw();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, thumbnail]);
  return (
    <canvas
      ref={canvas}
      className={thumbnail ? "slide-thumb" : "slide-canvas"}
      aria-label={`第 ${page} 頁投影片`}
    />
  );
}
