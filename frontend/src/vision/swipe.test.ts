import { describe, expect, it } from "vitest";
import { SwipeDetector } from "./swipe";

function move(d: SwipeDetector, from: number, to: number, ms: number, t0 = 0): number[] {
  const out: number[] = [];
  for (let t = 0; t <= ms; t += 33) out.push(d.push(t0 + t, from + ((to - from) * t) / ms));
  return out;
}

describe("SwipeDetector", () => {
  it("sees a fast wave to the right", () => {
    expect(move(new SwipeDetector(), 0.3, 0.7, 200)).toContain(1);
  });

  it("sees a fast wave to the left", () => {
    expect(move(new SwipeDetector(), 0.7, 0.3, 200)).toContain(-1);
  });

  it("ignores a slow movement", () => {
    expect(move(new SwipeDetector(), 0.3, 0.7, 2000).every((v) => v === 0)).toBe(true);
  });

  it("counts one wave only once", () => {
    const d = new SwipeDetector();
    const results = move(d, 0.1, 0.9, 300);
    expect(results.filter((v) => v !== 0)).toEqual([1]);
  });

  it("forgets the hand when it leaves", () => {
    const d = new SwipeDetector();
    d.push(0, 0.2);
    d.push(30, null);
    expect(d.push(60, 0.8)).toBe(0);
  });
});
