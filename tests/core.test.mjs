import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSpeech,
  NavigationGate,
  GestureTracker,
  classifyHand,
  mapPointer,
} from "../src/core.mjs";

function hand(kind, x = 0.5) {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.65, z: 0 }));
  p[0] = { x, y: 0.9, z: 0 };
  p[9] = { x, y: 0.65, z: 0 };
  for (const [tip, pip] of [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ]) {
    p[pip] = { x, y: 0.55, z: 0 };
    p[tip] = {
      x,
      y: kind === "palm" || (kind === "point" && tip === 8) ? 0.25 : 0.72,
      z: 0,
    };
  }
  return p;
}
test("中文標點與空白可以辨識，但普通報告內容不會換頁", () => {
  assert.deepEqual(parseSpeech("下一頁！"), { type: "next" });
  assert.deepEqual(parseSpeech("上一頁"), { type: "previous" });
  assert.deepEqual(parseSpeech("請下一頁"), { type: "next" });
  assert.deepEqual(parseSpeech("簡報，下一頁。"), { type: "next" });
  assert.deepEqual(parseSpeech(" 簡報 上一頁 "), { type: "previous" });
  assert.deepEqual(parseSpeech("簡報，繼續"), { type: "resume" });
  assert.equal(parseSpeech("我們在下一頁會看到數字"), null);
  assert.equal(parseSpeech("大家有沒有看過水豚"), null);
});
test("手勢與語音共用冷卻，同時下一頁只執行一次", () => {
  const gate = new NavigationGate();
  const gesture = gate.navigate(1, 5, 1, 1000);
  const voice = gate.navigate(gesture.page, 5, 1, 1100);
  assert.equal(gesture.page, 2);
  assert.equal(voice.page, 2);
  assert.equal(voice.reason, "cooldown");
  assert.equal(gate.navigate(2, 5, -1, 2300).page, 1);
  assert.equal(gate.navigate(1, 5, -1, 3500).reason, "boundary");
});
test("食指移動只更新指示器，不會誤判左右揮", () => {
  const tracker = new GestureTracker();
  for (let i = 0; i < 10; i++) {
    const state = tracker.update(hand("point", 0.8 - i * 0.06), i * 60);
    assert.equal(state.kind, "point");
    assert.ok(state.pointer);
    assert.equal(state.action, null);
  }
});
test("鏡像映射與畫面邊界", () => {
  assert.deepEqual(mapPointer({ x: 0, y: 1 }), { x: 1, y: 1 });
  assert.deepEqual(mapPointer({ x: 1, y: 0 }), { x: 0, y: 0 });
  assert.equal(classifyHand(null), "none");
});
test("張掌右揮觸發下一頁，左揮觸發上一頁", () => {
  let tracker = new GestureTracker();
  let actions = [];
  for (let i = 0; i < 7; i++) {
    const r = tracker.update(hand("palm", 0.8 - i * 0.055), i * 70);
    if (r.action) actions.push(r.action);
  }
  assert.deepEqual(actions, ["next"]);
  tracker = new GestureTracker();
  actions = [];
  for (let i = 0; i < 7; i++) {
    const r = tracker.update(hand("palm", 0.2 + i * 0.055), i * 70);
    if (r.action) actions.push(r.action);
  }
  assert.deepEqual(actions, ["previous"]);
});
test("張掌停住不觸發動作；手動暫停後指尖不再移動", () => {
  const tracker = new GestureTracker();
  let actions = [];
  for (let i = 0; i < 50; i++) {
    const r = tracker.update(hand("palm"), i * 100);
    if (r.action) actions.push(r.action);
  }
  assert.deepEqual(actions, []);
  const paused = tracker.update(hand("point"), 1600, true);
  assert.equal(paused.pointer, null);
  assert.equal(paused.action, null);
});
test("手離開鏡頭會清除指示與未完成動作", () => {
  const tracker = new GestureTracker();
  tracker.update(hand("palm", 0.8), 0);
  tracker.update(null, 200);
  assert.equal(tracker.update(hand("palm", 0.4), 300).action, null);
  assert.equal(tracker.update(null, 400).pointer, null);
});

test("較小且稍慢的揮手可翻頁，微小晃動不會誤觸", () => {
  const tracker = new GestureTracker();
  tracker.update(hand("palm", 0.6), 0);
  assert.equal(tracker.update(hand("palm", 0.47), 700).action, "next");
  const jitter = new GestureTracker();
  for (let i = 0; i < 30; i++) {
    const result = jitter.update(hand("palm", 0.5 + Math.sin(i) * 0.025), i * 50);
    assert.equal(result.action, null);
  }
});

test("指示筆以中央 40% 鏡頭範圍映射整張投影片", () => {
  const center = mapPointer({x: 0.5, y: 0.5});
  const moved = mapPointer({x: 0.4, y: 0.6});
  assert.ok(Math.abs(center.x - 0.5) < 1e-9);
  assert.ok(Math.abs(moved.x - center.x - 0.25) < 1e-9);
  assert.ok(Math.abs(moved.y - center.y - 0.25) < 1e-9);
  assert.ok(mapPointer({x: 0.3, y: 0.7}).x > 0.999);
});
