import { describe, expect, it } from "vitest";
import { detectPitch, logBands, pitchName, rms } from "./analysis";

const RATE = 48000;

function sine(hz: number, amp = 0.5, n = 2048, harmonics = false): Float32Array {
  const wave = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    wave[i] = amp * Math.sin(2 * Math.PI * hz * t);
    // a voice has overtones; they must not fool the pitch finder
    if (harmonics) wave[i] += amp * 0.5 * Math.sin(4 * Math.PI * hz * t) + amp * 0.3 * Math.sin(6 * Math.PI * hz * t);
  }
  return wave;
}

describe("detectPitch", () => {
  it.each([110, 220, 440, 880])("finds %i Hz", (hz) => {
    expect(detectPitch(sine(hz), RATE)).toBeGreaterThan(hz * 0.97);
    expect(detectPitch(sine(hz), RATE)).toBeLessThan(hz * 1.03);
  });

  it("finds the base tone of a voice-like wave with overtones", () => {
    const hz = detectPitch(sine(150, 0.4, 2048, true), RATE)!;
    expect(hz).toBeGreaterThan(145);
    expect(hz).toBeLessThan(155);
  });

  it("returns null for silence and for noise", () => {
    expect(detectPitch(new Float32Array(2048), RATE)).toBeNull();
    let seed = 1;
    const noise = new Float32Array(2048).map(() => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.6;
    });
    expect(detectPitch(noise, RATE)).toBeNull();
  });
});

describe("logBands", () => {
  it("puts a loud 1000 Hz tone into the right band and leaves the others quiet", () => {
    const bins = 1024;
    const db = new Float32Array(bins).fill(-100);
    const binHz = RATE / 2 / bins;
    db[Math.round(1000 / binHz)] = -30;
    const bands = logBands(db, RATE, 32);
    const loud = Array.from(bands).findIndex((b) => b > 0.9);
    const expected = Math.floor((Math.log(1000 / 80) / Math.log(5000 / 80)) * 32);
    expect(Math.abs(loud - expected)).toBeLessThanOrEqual(1);
    expect(Array.from(bands).filter((b) => b > 0.1)).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("rms of a sine is amplitude / sqrt(2)", () => {
    expect(rms(sine(440, 0.5, 4800))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("names pitches", () => {
    expect(pitchName(100)).toBe("low");
    expect(pitchName(250)).toBe("middle");
    expect(pitchName(600)).toBe("high");
  });
});
