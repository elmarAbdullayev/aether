import type { Sound } from "../../audio/sound";
import type { BlackHole, ParticleWorld, Star } from "../../engine/world";
import type { Gesture, Point } from "../../vision/gestures";

/** One hand (camera) or the mouse, already in screen coordinates (0..1, y down). */
export interface HandInput {
  id: string;
  gesture: Gesture;
  palm: Point;
  tip: Point;
  pinch: Point;
  /** All 21 points, only for camera hands. Drawn as a glowing skeleton. */
  joints?: Point[];
}

interface Vec {
  x: number;
  y: number;
}

interface HandState {
  gesture: Gesture;
  tipPrev: Vec | null;
  tipVel: Vec;
  pinchPrev: Vec | null;
  pinchVel: Vec;
  palm: Vec;
  hole: BlackHole | null;
  /** Fist just opened: wait a moment for the open hand before deciding. */
  pending: { x: number; y: number; charge: number; timer: number } | null;
  star: Star | null;
}

const CHARGE_SECONDS = 1.8;
const OPEN_WINDOW = 0.45;

/**
 * The rules of Hand Magic:
 * finger = particles follow, fist = black hole, fist then open = explosion,
 * pinch = grab a star (release to throw), two hands = zoom.
 */
export class MagicController {
  private states = new Map<string, HandState>();
  private zoom: { d0: number; s0: number } | null = null;

  constructor(
    private readonly world: ParticleWorld,
    private readonly sound: Sound,
  ) {
    world.onStarPop = () => sound.pop();
  }

  /** Gestures of the hands seen in the last update, for the interface. */
  gestures(): Gesture[] {
    return [...this.states.values()].map((s) => s.gesture);
  }

  update(hands: HandInput[], dt: number): void {
    const world = this.world;
    world.attractors.length = 0;
    world.holes.length = 0;
    const seen = new Set<string>();

    for (const hand of hands) {
      seen.add(hand.id);
      let st = this.states.get(hand.id);
      if (!st) {
        st = {
          gesture: "none",
          tipPrev: null,
          tipVel: { x: 0, y: 0 },
          pinchPrev: null,
          pinchVel: { x: 0, y: 0 },
          palm: { x: 0, y: 0 },
          hole: null,
          pending: null,
          star: null,
        };
        this.states.set(hand.id, st);
      }
      const tip = world.toWorld(hand.tip.x, hand.tip.y);
      const pinch = world.toWorld(hand.pinch.x, hand.pinch.y);
      st.palm = world.toWorld(hand.palm.x, hand.palm.y);
      track(st.tipPrev, tip, st.tipVel, dt);
      track(st.pinchPrev, pinch, st.pinchVel, dt);
      st.tipPrev = tip;
      st.pinchPrev = pinch;

      if (hand.gesture !== st.gesture) this.transition(st, hand.gesture, pinch);
      st.gesture = hand.gesture;

      if (st.pending) {
        st.pending.timer -= dt;
        if (st.pending.timer <= 0) {
          // the hand did not open: the black hole fades with a small pop
          world.explode(st.pending.x, st.pending.y, 0.35, true);
          st.pending = null;
        }
      }

      if (st.gesture === "fist" && st.hole) {
        st.hole.x = st.palm.x;
        st.hole.y = st.palm.y;
        st.hole.charge = Math.min(1, st.hole.charge + dt / CHARGE_SECONDS);
        world.holes.push(st.hole);
      } else if (st.gesture === "pinch" && st.star) {
        st.star.x = pinch.x;
        st.star.y = pinch.y;
        st.star.vx = st.pinchVel.x;
        st.star.vy = st.pinchVel.y;
      } else if (st.gesture !== "fist") {
        world.attractors.push({ x: tip.x, y: tip.y, vx: st.tipVel.x, vy: st.tipVel.y });
      }
    }

    for (const [id, st] of this.states) {
      if (seen.has(id)) continue;
      // hand left the picture: let go of everything it held
      if (st.star) this.throwStar(st);
      if (st.hole) world.explode(st.hole.x, st.hole.y, 0.35, true);
      this.states.delete(id);
    }

    const charge = world.holes.reduce((m, h) => Math.max(m, h.charge), -1);
    this.sound.blackHole(charge >= 0 ? charge : null);

    const free = hands.filter((h) => h.gesture !== "fist" && h.gesture !== "pinch");
    if (free.length >= 2) {
      const d = Math.hypot(free[0].palm.x - free[1].palm.x, free[0].palm.y - free[1].palm.y);
      if (!this.zoom) this.zoom = { d0: Math.max(d, 0.05), s0: world.targetScale };
      else world.targetScale = clamp((this.zoom.s0 * d) / this.zoom.d0, 0.35, 2.6);
    } else {
      this.zoom = null;
    }

    world.setHands(hands.filter((h) => h.joints).map((h) => h.joints!.map((p) => world.toWorld(p.x, p.y))));
  }

  private transition(st: HandState, next: Gesture, pinch: Vec): void {
    const prev = st.gesture;
    if (prev === "fist" && st.hole) {
      const { x, y, charge } = st.hole;
      st.hole = null;
      if (next === "open") this.explode(x, y, charge);
      else st.pending = { x, y, charge, timer: OPEN_WINDOW };
    }
    if (prev === "pinch" && st.star) this.throwStar(st);

    if (next === "fist") {
      st.pending = null;
      st.hole = { x: st.palm.x, y: st.palm.y, charge: 0 };
    } else if (next === "pinch") {
      st.star = this.world.addStar(pinch.x, pinch.y);
      if (st.star) this.sound.grab();
    } else if (next === "open" && st.pending) {
      this.explode(st.pending.x, st.pending.y, st.pending.charge);
      st.pending = null;
    }
  }

  private explode(x: number, y: number, charge: number): void {
    if (charge < 0.12) {
      this.world.explode(x, y, 0.4, true);
      return;
    }
    const power = 0.3 + 0.7 * charge;
    this.world.explode(x, y, power);
    this.sound.explosion(power);
  }

  private throwStar(st: HandState): void {
    const star = st.star!;
    st.star = null;
    star.held = false;
    star.life = 4.5;
    const speed = Math.hypot(st.pinchVel.x, st.pinchVel.y);
    const limit = speed > 35 ? 35 / speed : 1.1;
    star.vx = st.pinchVel.x * limit;
    star.vy = st.pinchVel.y * limit;
    if (speed > 2) this.sound.whoosh(speed);
  }
}

function track(prev: Vec | null, now: Vec, vel: Vec, dt: number): void {
  if (!prev || dt <= 0) return;
  vel.x += ((now.x - prev.x) / dt - vel.x) * 0.45;
  vel.y += ((now.y - prev.y) / dt - vel.y) * 0.45;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
