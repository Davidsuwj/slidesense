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
test("食指移動只更新指示器，不會觸發翻頁", () => {
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

function thumb(direction, mirrored = false) {
  const points = hand("fist");
  points[2] = { x: 0.5, y: 0.6, z: 0 };
  points[3] = { x: 0.52, y: 0.4, z: 0 };
  points[4] = { x: 0.54, y: 0.2, z: 0 };
  return points.map((p) => ({
    x: mirrored ? 1 - p.x : p.x,
    y: direction === "down" ? 1 - p.y : p.y,
    z: p.z,
  }));
}
test("左右手比讚與倒讚皆可辨識，穩定後才翻頁", () => {
  for (const mirrored of [false, true]) {
    for (const [direction, action] of [
      ["up", "next"],
      ["down", "previous"],
    ]) {
      const tracker = new GestureTracker();
      assert.equal(
        classifyHand(thumb(direction, mirrored)),
        "thumb-" + direction,
      );
      assert.equal(tracker.update(thumb(direction, mirrored), 0).action, null);
      assert.equal(
        tracker.update(thumb(direction, mirrored), 200).action,
        action,
      );
      assert.equal(
        tracker.update(thumb(direction, mirrored), 3000).action,
        null,
      );
    }
  }
});
test("短暫追蹤中斷不會連跳；放鬆後可再次比讚", () => {
  const tracker = new GestureTracker();
  tracker.update(thumb("up"), 0);
  tracker.update(thumb("up"), 200);
  tracker.update(null, 1500);
  assert.equal(tracker.update(thumb("up"), 1550).action, null);
  assert.equal(tracker.update(thumb("up"), 1800).action, null);
  tracker.update(hand("palm"), 2000);
  tracker.update(hand("palm"), 2300);
  tracker.update(thumb("up"), 2400);
  assert.equal(tracker.update(thumb("up"), 2600).action, "next");
});
test("可由比讚切換倒讚，仍遵守冷卻", () => {
  const tracker = new GestureTracker();
  tracker.update(thumb("up"), 0);
  tracker.update(thumb("up"), 200);
  tracker.update(thumb("down"), 400);
  assert.equal(tracker.update(thumb("down"), 600).action, null);
  assert.equal(tracker.update(thumb("down"), 1400).action, "previous");
});
test("左右揮與張掌停住不再翻頁；暫停時指尖不移動", () => {
  const tracker = new GestureTracker();
  for (let i = 0; i < 40; i++)
    assert.equal(
      tracker.update(hand("palm", 0.5 + Math.sin(i) * 0.3), i * 100).action,
      null,
    );
  assert.equal(tracker.update(hand("point"), 4200, true).pointer, null);
  assert.equal(tracker.update(null, 4300).pointer, null);
});
test("指示筆以中央 40% 鏡頭範圍映射整張投影片", () => {
  const center = mapPointer({ x: 0.5, y: 0.5 });
  const moved = mapPointer({ x: 0.4, y: 0.6 });
  assert.ok(Math.abs(center.x - 0.5) < 1e-9);
  assert.ok(Math.abs(moved.x - center.x - 0.25) < 1e-9);
  assert.ok(Math.abs(moved.y - center.y - 0.25) < 1e-9);
});
