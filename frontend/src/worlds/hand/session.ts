import { Sound } from "../../audio/sound";
import type { ElementName } from "../../engine/elements";
import { ParticleWorld } from "../../engine/world";
import { classifyHand, GestureStabilizer, OneEuro, palmCenter, toScreen, type Gesture, type Point } from "../../vision/gestures";
import { HandTracker, type RawHand } from "../../vision/handTracker";
import type { VoiceCommand } from "../../voice/commands";
import { VoiceControl, type VoiceState } from "../../voice/voice";
import { MagicController, type HandInput } from "./controller";

export interface SessionEvents {
  gestures(gestures: Gesture[]): void;
  handsVisible(visible: boolean): void;
  element(name: ElementName): void;
  voiceState(state: VoiceState): void;
  heard(text: string): void;
  command(command: VoiceCommand): void;
}

interface Filters {
  stabilizer: GestureStabilizer;
  f: OneEuro[];
  lastSeen: number;
}

const LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/**
 * Runs Hand Magic: the frame loop, camera, mouse, voice and sound.
 * React only shows the interface around it.
 */
export class HandSession {
  readonly world: ParticleWorld;
  readonly sound = new Sound();
  private controller: MagicController;
  private tracker: HandTracker | null = null;
  private voice: VoiceControl;
  private filters = new Map<string, Filters>();
  private raw: RawHand[] = [];
  private frameId = 0;
  private last = 0;
  private gestureKey = "";
  private visible = false;
  private lastHandAt = 0;
  private preview: CanvasRenderingContext2D | null = null;
  private mouse = { x: 0.5, y: 0.5, down: 0 as 0 | 1 | 2, movedAt: -1e9, releasedAt: -1e9 };
  private disposers: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: SessionEvents,
  ) {
    this.world = new ParticleWorld(canvas);
    this.controller = new MagicController(this.world, this.sound);
    this.voice = new VoiceControl({
      onCommand: (c) => events.command(c),
      onHeard: (t) => events.heard(t),
      onState: (s) => events.voiceState(s),
    });
    this.bindMouse();
    // dev only: lets tests drive the world from the console
    if (import.meta.env.DEV) (window as unknown as { __aether?: unknown }).__aether = { world: this.world, session: this };
    const onResize = () => this.world.resize();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.frameId = requestAnimationFrame(this.frame);
  }

  get cameraOn(): boolean {
    return this.tracker !== null;
  }

  async startCamera(video: HTMLVideoElement): Promise<void> {
    if (this.tracker) return;
    this.tracker = await HandTracker.start(video);
    this.lastHandAt = performance.now();
  }

  startVoice(): void {
    this.voice.start();
  }

  setElement(name: ElementName): void {
    if (name === this.world.elementName) return;
    this.world.setElement(name);
    this.sound.element(name);
    this.events.element(name);
  }

  setCalm(calm: boolean): void {
    this.world.calm = calm;
    this.sound.setCalm(calm);
  }

  setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
  }

  setPreview(canvas: HTMLCanvasElement | null): void {
    this.preview = canvas?.getContext("2d") ?? null;
  }

  capture(): string {
    this.sound.shutter();
    return this.world.capture();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.disposers.forEach((d) => d());
    this.voice.stop();
    this.sound.blackHole(null);
    this.sound.dispose();
    this.tracker?.stop();
    this.world.dispose();
  }

  /* ------------------------------------------------------------------- */

  private frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const dt = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;

    const hands: HandInput[] = [];
    if (this.tracker) {
      this.raw = this.tracker.detect(now);
      const aspect = this.tracker.aspect;
      for (const raw of this.raw) hands.push(this.readHand(raw, aspect, now, dt));
      for (const [id, f] of this.filters) if (now - f.lastSeen > 400) this.filters.delete(id);
      if (this.raw.length) this.lastHandAt = now;
      this.setVisible(now - this.lastHandAt < 1500);
    }
    const mouse = this.mouseHand(now);
    if (mouse) hands.push(mouse);

    this.controller.update(hands, dt);
    const gestures = this.controller.gestures();
    const key = gestures.join(",");
    if (key !== this.gestureKey) {
      this.gestureKey = key;
      this.events.gestures(gestures);
    }

    this.world.step(dt);
    this.world.render();
    this.drawPreview();
  };

  private readHand(raw: RawHand, aspect: number, now: number, dt: number): HandInput {
    let f = this.filters.get(raw.id);
    if (!f) {
      f = { stabilizer: new GestureStabilizer(3), f: Array.from({ length: 6 }, () => new OneEuro()), lastSeen: now };
      this.filters.set(raw.id, f);
    }
    f.lastSeen = now;
    const lm = raw.landmarks;
    const shape = classifyHand(lm, aspect);
    const gesture = f.stabilizer.push(shape.gesture);
    const smooth = (p: Point, k: number): Point => ({ x: f.f[k].filter(p.x, dt), y: f.f[k + 1].filter(p.y, dt) });
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

  private mouseHand(now: number): HandInput | null {
    const m = this.mouse;
    const recentlyMoved = now - m.movedAt < 3500;
    if (!m.down && !recentlyMoved) return null;
    let gesture: Gesture = "none";
    if (m.down === 1) gesture = "fist";
    else if (m.down === 2) gesture = "pinch";
    else if (now - m.releasedAt < 120) gesture = "open";
    const p = { x: m.x, y: m.y };
    return { id: "mouse", gesture, tip: p, palm: p, pinch: p };
  }

  private bindMouse(): void {
    const c = this.canvas;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
      this.mouse.movedAt = performance.now();
    };
    const move = (e: PointerEvent) => at(e);
    const down = (e: PointerEvent) => {
      at(e);
      this.sound.unlock();
      c.setPointerCapture(e.pointerId);
      this.mouse.down = e.button === 2 || e.shiftKey ? 2 : 1;
    };
    const up = (e: PointerEvent) => {
      at(e);
      if (this.mouse.down === 1) this.mouse.releasedAt = performance.now();
      this.mouse.down = 0;
    };
    const leave = () => {
      if (!this.mouse.down) this.mouse.movedAt = -1e9;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = this.world;
      w.targetScale = Math.min(2.6, Math.max(0.35, w.targetScale * Math.exp(-e.deltaY * 0.0012)));
    };
    const menu = (e: Event) => e.preventDefault();
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("contextmenu", menu);
    this.disposers.push(() => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("contextmenu", menu);
    });
  }

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.events.handsVisible(visible);
  }

  private drawPreview(): void {
    const ctx = this.preview;
    const video = this.tracker?.video;
    if (!ctx || !video || video.readyState < 2) return;
    const { width, height } = ctx.canvas;
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.fillStyle = "rgba(4, 4, 12, 0.35)";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = this.world.accentColor;
    ctx.lineWidth = 2;
    for (const hand of this.raw) {
      const lm = hand.landmarks;
      ctx.beginPath();
      for (const [a, b] of LINKS) {
        ctx.moveTo(lm[a].x * width, lm[a].y * height);
        ctx.lineTo(lm[b].x * width, lm[b].y * height);
      }
      ctx.stroke();
      ctx.fillStyle = "#fff";
      for (const p of lm) ctx.fillRect(p.x * width - 1.5, p.y * height - 1.5, 3, 3);
    }
    ctx.restore();
  }
}
