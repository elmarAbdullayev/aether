import * as THREE from "three";
import type { Sound } from "../../audio/sound";
import { brushColor, type BrushColor } from "../../engine/sculpture";
import type { Gesture, Point } from "../../vision/gestures";
import type { HandInput } from "../../vision/handInput";
import { SPIN, type DrawScene } from "./scene";

export interface DrawEvents {
  /** Number of strokes changed (drawn, undone, cleared). */
  strokes(count: number): void;
}

/**
 * The rules of Air Drawing:
 * pinch = pen down (draw), fist + move = turn the sculpture (let go and it keeps spinning),
 * two open hands = zoom.
 */
export class DrawController {
  brush: BrushColor = "rainbow";
  private penId: string | null = null;
  private grab: { id: string; last: Point; vel: number } | null = null;
  private zoom: { d0: number; s0: number } | null = null;
  private current: Gesture[] = [];
  private local = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(
    private readonly scene: DrawScene,
    private readonly sound: Sound,
    private readonly events: DrawEvents,
  ) {}

  gestures(): Gesture[] {
    return this.current;
  }

  update(hands: HandInput[], dt: number): void {
    const { scene } = this;
    const data = scene.data;
    this.current = hands.map((h) => h.gesture);

    // --- pen: keep the same hand while it pinches, otherwise take any pinching hand
    const pen = hands.find((h) => h.id === this.penId && h.gesture === "pinch") ?? hands.find((h) => h.gesture === "pinch");
    if (pen) {
      if (!data.drawing || this.penId !== pen.id) {
        data.begin(this.brush);
        this.penId = pen.id;
      }
      const w = scene.toWorld(pen.pinch.x, pen.pinch.y);
      const p = scene.toSculpture(w.x, w.y, this.local);
      data.add(p.x, p.y, p.z);
      const stroke = data.strokes[data.strokes.length - 1];
      brushColor(this.brush, data.strokes.length - 1, stroke ? stroke.count : 0, this.color);
      scene.sparks.emit(w.x, w.y, 0.3, this.color, scene.calm ? 1 : 3);
      this.sound.theremin(1 - Math.min(1, Math.max(0, pen.pinch.y)));
      scene.targetSpin = scene.calm ? SPIN.calmDrawing : SPIN.drawing;
    } else {
      if (data.drawing) {
        data.end();
        this.penId = null;
        this.sound.theremin(null);
        this.events.strokes(data.strokes.length);
      }
      scene.targetSpin = scene.calm ? SPIN.calmIdle : SPIN.idle;
    }

    // --- turning with a fist
    const fist = hands.find((h) => h.gesture === "fist" && h.id !== pen?.id);
    if (fist) {
      if (!this.grab || this.grab.id !== fist.id) {
        this.grab = { id: fist.id, last: { ...fist.palm }, vel: 0 };
        scene.grabbed = true;
      } else {
        const dx = fist.palm.x - this.grab.last.x;
        const dy = fist.palm.y - this.grab.last.y;
        scene.rotY += dx * 5.5;
        scene.rotX = Math.min(1.2, Math.max(-1.2, scene.rotX + dy * 3.5));
        if (dt > 0) this.grab.vel += ((dx * 5.5) / dt - this.grab.vel) * 0.4;
        this.grab.last = { ...fist.palm };
      }
    } else if (this.grab) {
      // let go: it keeps the swing and slowly returns to the normal speed
      scene.spin = Math.min(6, Math.max(-6, this.grab.vel));
      scene.grabbed = false;
      this.grab = null;
    }

    // --- zoom with two free hands
    const free = hands.filter((h) => h.gesture !== "pinch" && h.gesture !== "fist");
    if (free.length >= 2) {
      const d = Math.hypot(free[0].palm.x - free[1].palm.x, free[0].palm.y - free[1].palm.y);
      if (!this.zoom) this.zoom = { d0: Math.max(d, 0.05), s0: scene.targetScale };
      else scene.targetScale = Math.min(2.4, Math.max(0.4, (this.zoom.s0 * d) / this.zoom.d0));
    } else {
      this.zoom = null;
    }

    brushColor(this.brush, data.strokes.length, 0, this.color);
    scene.overlay.update(
      hands.filter((h) => h.joints).map((h) => h.joints!.map((p) => scene.toWorld(p.x, p.y))),
      hands.map((h) => ({ ...scene.toWorld(h.pinch.x, h.pinch.y), active: h.gesture === "pinch" })),
      this.color,
    );
  }

  setBrush(brush: BrushColor): void {
    this.brush = brush;
    const data = this.scene.data;
    // a color change while drawing starts a new stroke in the new color
    if (data.drawing) data.begin(brush);
  }

  undo(): boolean {
    const done = this.scene.data.undo();
    if (done) {
      this.sound.pop();
      this.events.strokes(this.scene.data.strokes.length);
    }
    return done;
  }

  clear(): void {
    const data = this.scene.data;
    if (!data.strokes.length) return;
    data.clear();
    this.sound.whoosh(25);
    this.events.strokes(0);
  }
}
