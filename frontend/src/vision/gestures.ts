/**
 * Turns the 21 MediaPipe hand points into a gesture. Pure functions, no browser needed,
 * so the rules are covered by unit tests.
 *
 * Point numbers: 0 wrist, 4 thumb tip, 5/9/13/17 finger roots, 8/12/16/20 finger tips.
 */

export type Gesture = "none" | "point" | "pinch" | "fist" | "open";

export interface Point {
  x: number;
  y: number;
}

export interface Landmark extends Point {
  z?: number;
}

export interface HandShape {
  gesture: Gesture;
  /** Distance thumb tip to index tip, divided by hand size. */
  pinchRatio: number;
  /** How far each finger (index, middle, ring, pinky) is stretched out. ~1 curled, ~2 straight. */
  fingerRatios: [number, number, number, number];
  thumbOut: boolean;
}

const FINGERS: [tip: number, root: number][] = [
  [8, 5],
  [12, 9],
  [16, 13],
  [20, 17],
];

export const THRESHOLDS = {
  extended: 1.55,
  curled: 1.3,
  pinchEnter: 0.3,
  pinchIndexMin: 1.15,
  thumbOut: 0.55,
};

/** aspect = video width / height. Landmark x and y are scaled differently, this corrects it. */
export function distance(a: Landmark, b: Landmark, aspect = 1): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function classifyHand(lm: Landmark[], aspect = 1): HandShape {
  const wrist = lm[0];
  const size = Math.max(distance(wrist, lm[9], aspect), 1e-6);
  const fingerRatios = FINGERS.map(
    ([tip, root]) => distance(lm[tip], wrist, aspect) / Math.max(distance(lm[root], wrist, aspect), 1e-6),
  ) as [number, number, number, number];
  const pinchRatio = distance(lm[4], lm[8], aspect) / size;
  const thumbOut = distance(lm[4], lm[5], aspect) / size > THRESHOLDS.thumbOut;

  const extended = fingerRatios.map((r) => r > THRESHOLDS.extended);
  const curled = fingerRatios.map((r) => r < THRESHOLDS.curled);

  let gesture: Gesture = "none";
  if (pinchRatio < THRESHOLDS.pinchEnter && fingerRatios[0] > THRESHOLDS.pinchIndexMin) gesture = "pinch";
  else if (curled.every(Boolean)) gesture = "fist";
  else if (extended.every(Boolean) && thumbOut) gesture = "open";
  else if (extended[0] && curled[1] && curled[2] && curled[3]) gesture = "point";

  return { gesture, pinchRatio, fingerRatios, thumbOut };
}

export function palmCenter(lm: Landmark[]): Point {
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

/**
 * A gesture only counts after it was seen for a few frames in a row.
 * This stops flicker when the hand is half way between two gestures.
 */
export class GestureStabilizer {
  private current: Gesture = "none";
  private candidate: Gesture = "none";
  private seen = 0;

  constructor(private readonly frames = 3) {}

  get value(): Gesture {
    return this.current;
  }

  push(gesture: Gesture): Gesture {
    if (gesture === this.current) {
      this.candidate = gesture;
      this.seen = 0;
      return this.current;
    }
    if (gesture === this.candidate) this.seen++;
    else {
      this.candidate = gesture;
      this.seen = 1;
    }
    // letting go of a pinch should feel instant, so the throw happens where you release
    const needed = this.current === "pinch" ? 2 : this.frames;
    if (this.seen >= needed) {
      this.current = gesture;
      this.seen = 0;
    }
    return this.current;
  }
}

/** Screen coordinates (0..1, y down) from camera coordinates: mirrored, with a margin
 * so you do not have to reach the very edge of the camera picture. */
export function toScreen(p: Point, margin = 0.1): Point {
  const span = 1 - 2 * margin;
  return { x: (1 - p.x - margin) / span, y: (p.y - margin) / span };
}

/** One Euro filter: smooth when the hand is still, fast when it moves. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(
    private readonly minCutoff = 1.4,
    private readonly beta = 3,
    private readonly dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      return value;
    }
    const dValue = (value - this.x) / dt;
    this.dx += (dValue - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (value - this.x) * OneEuro.alpha(cutoff, dt);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}
