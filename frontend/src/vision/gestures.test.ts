import { describe, expect, it } from "vitest";
import { classifyHand, GestureStabilizer, OneEuro, toScreen, type Landmark } from "./gestures";

type Finger = "out" | "curled";

/** A flat test hand: wrist at the bottom, fingers pointing up. */
function hand(opts: { fingers: [Finger, Finger, Finger, Finger]; thumb: "out" | "in" | "pinch" }): Landmark[] {
  const wrist = { x: 0.5, y: 0.8 };
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ ...wrist }));
  const roots = [0.44, 0.48, 0.52, 0.56];
  [5, 9, 13, 17].forEach((id, i) => (lm[id] = { x: roots[i], y: 0.6 }));
  [8, 12, 16, 20].forEach((id, i) => {
    lm[id] = opts.fingers[i] === "out" ? { x: roots[i], y: 0.35 } : { x: roots[i] + 0.01, y: 0.68 };
  });
  if (opts.thumb === "out") lm[4] = { x: 0.3, y: 0.62 };
  if (opts.thumb === "in") lm[4] = { x: 0.46, y: 0.66 };
  if (opts.thumb === "pinch") {
    lm[8] = { x: 0.41, y: 0.44 };
    lm[4] = { x: 0.4, y: 0.45 };
  }
  return lm;
}

describe("classifyHand", () => {
  it("sees an open hand", () => {
    expect(classifyHand(hand({ fingers: ["out", "out", "out", "out"], thumb: "out" })).gesture).toBe("open");
  });

  it("sees a fist, even though thumb and index tip are close", () => {
    const shape = classifyHand(hand({ fingers: ["curled", "curled", "curled", "curled"], thumb: "in" }));
    expect(shape.pinchRatio).toBeLessThan(0.3);
    expect(shape.gesture).toBe("fist");
  });

  it("sees a pinch", () => {
    expect(classifyHand(hand({ fingers: ["out", "curled", "curled", "curled"], thumb: "pinch" })).gesture).toBe("pinch");
    expect(classifyHand(hand({ fingers: ["out", "out", "out", "out"], thumb: "pinch" })).gesture).toBe("pinch");
  });

  it("sees pointing", () => {
    expect(classifyHand(hand({ fingers: ["out", "curled", "curled", "curled"], thumb: "in" })).gesture).toBe("point");
  });

  it("is not open when the thumb is folded in", () => {
    expect(classifyHand(hand({ fingers: ["out", "out", "out", "out"], thumb: "in" })).gesture).toBe("none");
  });
});

describe("GestureStabilizer", () => {
  it("needs three frames before a gesture counts", () => {
    const s = new GestureStabilizer(3);
    expect(s.push("fist")).toBe("none");
    expect(s.push("fist")).toBe("none");
    expect(s.push("fist")).toBe("fist");
  });

  it("ignores a single wrong frame", () => {
    const s = new GestureStabilizer(3);
    ["fist", "fist", "fist"].forEach((g) => s.push(g as "fist"));
    expect(s.push("open")).toBe("fist");
    expect(s.push("fist")).toBe("fist");
    expect(s.push("open")).toBe("fist");
  });

  it("lets go of a pinch after two frames", () => {
    const s = new GestureStabilizer(3);
    ["pinch", "pinch", "pinch"].forEach((g) => s.push(g as "pinch"));
    expect(s.push("none")).toBe("pinch");
    expect(s.push("none")).toBe("none");
  });
});

describe("toScreen", () => {
  it("mirrors the camera and keeps a margin", () => {
    expect(toScreen({ x: 0.1, y: 0.1 })).toEqual({ x: 1, y: 0 });
    expect(toScreen({ x: 0.9, y: 0.9 }).x).toBeCloseTo(0);
    expect(toScreen({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("OneEuro", () => {
  it("starts at the first value and follows a new value", () => {
    const f = new OneEuro();
    expect(f.filter(0.2, 1 / 30)).toBe(0.2);
    let v = 0.2;
    for (let i = 0; i < 60; i++) v = f.filter(0.8, 1 / 30);
    expect(v).toBeCloseTo(0.8, 2);
  });
});
