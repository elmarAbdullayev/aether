import { HAND_LINKS } from "../engine/hand";
import { classifyHand, GestureStabilizer, OneEuro, palmCenter, toScreen, type Gesture, type Point } from "./gestures";
import { HandTracker, type RawHand } from "./handTracker";

/** One hand (camera) or the mouse, in screen coordinates (0..1, y down). Every world reads these. */
export interface HandInput {
  id: string;
  gesture: Gesture;
  palm: Point;
  /** Index fingertip. */
  tip: Point;
  /** Middle between thumb tip and index tip. */
  pinch: Point;
  /** All 21 points, only for camera hands. Drawn as a glowing skeleton. */
  joints?: Point[];
}

interface Filters {
  stabilizer: GestureStabilizer;
  smooth: OneEuro[];
  lastSeen: number;
}

/** Camera hands: detected by MediaPipe, smoothed, with gestures that do not flicker. */
export class CameraHands {
  private filters = new Map<string, Filters>();
  private raw: RawHand[] = [];
  private lastHandAt: number;

  private constructor(private readonly tracker: HandTracker) {
    this.lastHandAt = performance.now();
  }

  static async start(video: HTMLVideoElement): Promise<CameraHands> {
    return new CameraHands(await HandTracker.start(video));
  }

  read(now: number, dt: number): HandInput[] {
    this.raw = this.tracker.detect(now);
    const aspect = this.tracker.aspect;
    const hands = this.raw.map((raw) => this.readHand(raw, aspect, now, dt));
    for (const [id, f] of this.filters) if (now - f.lastSeen > 400) this.filters.delete(id);
    if (this.raw.length) this.lastHandAt = now;
    return hands;
  }

  /** False when no hand was seen for 1.5 seconds. */
  visible(now: number): boolean {
    return now - this.lastHandAt < 1500;
  }

  /** Mirrored camera picture with the detected points, for the small preview. */
  drawPreview(ctx: CanvasRenderingContext2D, color: string): void {
    const video = this.tracker.video;
    if (video.readyState < 2) return;
    const { width, height } = ctx.canvas;
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.fillStyle = "rgba(4, 4, 12, 0.35)";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (const hand of this.raw) {
      const lm = hand.landmarks;
      ctx.beginPath();
      for (let k = 0; k < HAND_LINKS.length; k += 2) {
        const a = lm[HAND_LINKS[k]];
        const b = lm[HAND_LINKS[k + 1]];
        ctx.moveTo(a.x * width, a.y * height);
        ctx.lineTo(b.x * width, b.y * height);
      }
      ctx.stroke();
      ctx.fillStyle = "#fff";
      for (const p of lm) ctx.fillRect(p.x * width - 1.5, p.y * height - 1.5, 3, 3);
    }
    ctx.restore();
  }

  stop(): void {
    this.tracker.stop();
  }

  private readHand(raw: RawHand, aspect: number, now: number, dt: number): HandInput {
    let f = this.filters.get(raw.id);
    if (!f) {
      f = { stabilizer: new GestureStabilizer(3), smooth: Array.from({ length: 6 }, () => new OneEuro()), lastSeen: now };
      this.filters.set(raw.id, f);
    }
    f.lastSeen = now;
    const lm = raw.landmarks;
    const gesture = f.stabilizer.push(classifyHand(lm, aspect).gesture);
    const smooth = (p: Point, k: number): Point => ({ x: f.smooth[k].filter(p.x, dt), y: f.smooth[k + 1].filter(p.y, dt) });
    const mid = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
    return {
      id: raw.id,
      gesture,
      tip: smooth(toScreen(lm[8]), 0),
      palm: smooth(toScreen(palmCenter(lm)), 2),
      pinch: smooth(toScreen(mid), 4),
      joints: lm.map((p) => toScreen(p)),
    };
  }
}

export interface MouseOptions {
  /** Gesture while the left button is down (or a finger touches). */
  left: Gesture;
  /** Gesture while the right button (or shift + left) is down. */
  right: Gesture;
  /** Mouse wheel: factor to multiply the zoom with. */
  onZoom(factor: number): void;
  /** Any button press. Browsers only allow sound after a press. */
  onPress?(): void;
}

/**
 * The mouse as a pretend hand, so the worlds also work without a camera.
 * After the left button is let go it reports "open" for a moment (needed for the explosion).
 */
export class MouseHand {
  private x = 0.5;
  private y = 0.5;
  private down: 0 | 1 | 2 = 0;
  private movedAt = -1e9;
  private releasedAt = -1e9;
  private dispose: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly options: MouseOptions,
  ) {
    const c = canvas;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      this.x = (e.clientX - r.left) / r.width;
      this.y = (e.clientY - r.top) / r.height;
      this.movedAt = performance.now();
    };
    const down = (e: PointerEvent) => {
      at(e);
      options.onPress?.();
      c.setPointerCapture(e.pointerId);
      this.down = e.button === 2 || e.shiftKey ? 2 : 1;
    };
    const up = (e: PointerEvent) => {
      at(e);
      if (this.down === 1) this.releasedAt = performance.now();
      this.down = 0;
    };
    const leave = () => {
      if (!this.down) this.movedAt = -1e9;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      options.onZoom(Math.exp(-e.deltaY * 0.0012));
    };
    const menu = (e: Event) => e.preventDefault();
    c.addEventListener("pointermove", at);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("contextmenu", menu);
    this.dispose = () => {
      c.removeEventListener("pointermove", at);
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("contextmenu", menu);
    };
  }

  /** The mouse hand, or null when the mouse is not being used. */
  read(now: number): HandInput | null {
    if (!this.down && now - this.movedAt > 3500) return null;
    let gesture: Gesture = "none";
    if (this.down === 1) gesture = this.options.left;
    else if (this.down === 2) gesture = this.options.right;
    else if (now - this.releasedAt < 120) gesture = "open";
    const p = { x: this.x, y: this.y };
    return { id: "mouse", gesture, tip: p, palm: p, pinch: p };
  }

  stop(): void {
    this.dispose();
  }
}
