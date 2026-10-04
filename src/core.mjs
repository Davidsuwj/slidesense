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
  if (extended.every((value) => !value)) {
    const palmSize = distance(points[0], points[9]);
    const dx = points[4].x - points[2].x;
    const dy = points[4].y - points[2].y;
    const thumbExtended =
      distance(points[4], points[0]) > distance(points[3], points[0]) * 1.08;
    if (
      palmSize > 0 &&
      thumbExtended &&
      Math.abs(dy) > palmSize * 0.45 &&
      Math.abs(dy) > Math.abs(dx) * 1.15
    ) {
      return dy < 0 ? "thumb-up" : "thumb-down";
    }
  }
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
    this.candidate = null;
    this.candidateSince = 0;
    this.neutralSince = null;
    this.latched = null;
    this.last = -Infinity;
  }
  update(points, now, paused = false) {
    const kind = classifyHand(points);
    const result = { kind, pointer: null, action: null };
    if (paused) {
      this.candidate = null;
      return result;
    }
    if (kind === "point") result.pointer = mapPointer(points[8]);
    if (kind !== "thumb-up" && kind !== "thumb-down") {
      this.candidate = null;
      if (this.neutralSince === null) this.neutralSince = now;
      if (now - this.neutralSince >= 220) this.latched = null;
      return result;
    }
    this.neutralSince = null;
    if (this.candidate !== kind) {
      this.candidate = kind;
      this.candidateSince = now;
    }
    // Require a stable pose; holding it must not repeatedly turn pages.
    if (
      now - this.candidateSince >= 180 &&
      this.latched !== kind &&
      now - this.last >= 1100
    ) {
      result.action = kind === "thumb-up" ? "next" : "previous";
      this.latched = kind;
      this.last = now;
    }
    return result;
  }
}
