export function parseSpeech(text) {
  const clean = text
    .replace(/[，。！？、,.!?\s]/g, "")
    .replace(/简报/g, "簡報")
    .replace(/继续/g, "繼續")
    .replace(/图片/g, "圖片")
    .replace(/有没有看过/g, "有沒有看過");
  if (/^(?:請|幫我)?(?:回到簡報|返回簡報|收起圖片)$/.test(clean))
    return { type: "dismiss" };
  if (/^(?:請)?簡報(?:繼續|恢復)$/.test(clean)) return { type: "resume" };
  if (/^(?:請)?簡報(?:暫停|暂停)$/.test(clean)) return { type: "pause" };
  if (/^(?:請)?(?:簡報)?(?:下一頁|下一页|下頁)$/.test(clean))
    return { type: "next" };
  if (/^(?:請)?(?:簡報)?(?:上一頁|上一页|上頁)$/.test(clean))
    return { type: "previous" };
  return null;
}

export class NavigationGate {
  constructor(cooldown = 1100) {
    this.cooldown = cooldown;
    this.last = -Infinity;
  }
  navigate(current, total, direction, now) {
    if (now - this.last < this.cooldown)
      return { page: current, changed: false, reason: "cooldown" };
    const page = Math.max(1, Math.min(total, current + direction));
    if (page === current) return { page, changed: false, reason: "boundary" };
    this.last = now;
    return { page, changed: true };
  }
}

const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
export function classifyHand(points) {
  if (!points || points.length !== 21) return "none";
  const extended = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ].map(
    ([tip, pip]) =>
      distance(points[tip], points[0]) >
      distance(points[pip], points[0]) * 1.18,
  );
  if (extended[0] && !extended[1] && !extended[2] && !extended[3])
    return "point";
  if (extended.every(Boolean)) return "palm";
  return "other";
}
export function mapPointer(point) {
  const clamp = (x) => Math.max(0, Math.min(1, x));
  return {
    x: clamp((1 - point.x - 0.3) / 0.4),
    y: clamp((point.y - 0.3) / 0.4),
  };
}

export class GestureTracker {
  constructor() {
    this.reset();
  }
  reset() {
    this.history = [];
    this.previous = "none";
    this.last = -Infinity;
  }
  update(points, now, paused = false) {
    const kind = classifyHand(points);
    const result = { kind, pointer: null, action: null };
    if (paused || kind === "none") {
      this.history = [];
      this.previous = kind;
      return result;
    }
    if (kind === "point") {
      result.pointer = mapPointer(points[8]);
      this.history = [];
    } else if (kind === "palm") {
      const x = 1 - points[9].x,
        y = points[9].y;
      if (this.previous !== "palm") {
        this.history = [];
      }
      this.history.push({ x, y, t: now });
      this.history = this.history.filter((p) => now - p.t < 800);
      const start = this.history[0];
      const dx = x - start.x,
        dy = y - start.y;
      if (Math.abs(dx) > 0.12 && Math.abs(dy) < 0.18 && now - this.last > 1100) {
        result.action = dx > 0 ? "next" : "previous";
        this.last = now;
        this.history = [];
      }
    } else {
      this.history = [];
    }
    this.previous = kind;
    return result;
  }
}
