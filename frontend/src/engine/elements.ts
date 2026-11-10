/**
 * The four "elements" the particles can become. Each element is a shape (where every
 * particle wants to be) plus a color and a few motion settings. Switching element makes
 * all particles fly to the new shape, which is the morph effect.
 */

export type ElementName = "galaxy" | "fire" | "ice" | "rainbow";

export const ELEMENT_ORDER: ElementName[] = ["galaxy", "fire", "ice", "rainbow"];

export interface Out3 {
  x: number;
  y: number;
  z: number;
}

/** Four numbers per particle, chosen once. Their meaning depends on the element. */
export const PARAM_STRIDE = 4;

export interface ElementDef {
  name: ElementName;
  label: string;
  /** CSS accent color for the interface. */
  accent: string;
  /** How strongly particles are pulled back to their home position. */
  spring: number;
  /** Strength of the gentle wobble that keeps particles alive. */
  turbulence: number;
  seed(params: Float32Array, count: number, rand: () => number): void;
  /** Called once per frame before home()/color(). */
  begin(time: number): void;
  home(i: number, params: Float32Array, out: Out3): void;
  color(i: number, params: Float32Array, out: Out3): void;
}

const TAU = Math.PI * 2;

export function gauss(rand: () => number): number {
  // Box-Muller, good enough for shapes.
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
}

function hex(value: number): [number, number, number] {
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function mix(out: Out3, a: [number, number, number], b: [number, number, number], t: number): void {
  out.x = a[0] + (b[0] - a[0]) * t;
  out.y = a[1] + (b[1] - a[1]) * t;
  out.z = a[2] + (b[2] - a[2]) * t;
}

function hsl(out: Out3, h: number, s: number, l: number): void {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  out.x = f(0);
  out.y = f(8);
  out.z = f(4);
}

/* ---------------------------------------------------------------- galaxy */

const G_CORE = hex(0xc9b48f);
const G_INNER = hex(0xb58cff);
const G_OUTER = hex(0x3fb4ff);
const G_PINK = hex(0xff5fd2);

function galaxy(): ElementDef {
  let cosA = 1;
  let sinA = 0;
  const tilt = 1.08;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  return {
    name: "galaxy",
    label: "Galaxy",
    accent: "#9b7bff",
    spring: 2.2,
    turbulence: 0.5,
    seed(p, count, rand) {
      for (let i = 0; i < count; i++) {
        const o = i * PARAM_STRIDE;
        if (rand() < 0.08) {
          const r = Math.abs(gauss(rand)) * 0.45;
          const th = rand() * TAU;
          const ph = Math.acos(2 * rand() - 1);
          p[o] = Math.sin(ph) * Math.cos(th) * r;
          p[o + 1] = Math.cos(ph) * r * 0.6;
          p[o + 2] = Math.sin(ph) * Math.sin(th) * r;
          p[o + 3] = rand() * 0.12;
        } else {
          const arm = Math.floor(rand() * 3);
          const r = 0.45 + Math.pow(rand(), 0.75) * 4.0;
          const a = (arm * TAU) / 3 + r * 1.15 + gauss(rand) * 0.17 * (1.15 - r / 6);
          p[o] = Math.cos(a) * r + gauss(rand) * 0.07;
          p[o + 1] = gauss(rand) * 0.07 * (1.6 - r / 4.6);
          p[o + 2] = Math.sin(a) * r + gauss(rand) * 0.07;
          p[o + 3] = Math.min(1, r / 4.4) + (rand() < 0.05 ? 2 : 0);
        }
      }
    },
    begin(time) {
      cosA = Math.cos(time * 0.09);
      sinA = Math.sin(time * 0.09);
    },
    home(i, p, out) {
      const o = i * PARAM_STRIDE;
      const x = p[o] * cosA - p[o + 2] * sinA;
      const z = p[o] * sinA + p[o + 2] * cosA;
      const y = p[o + 1];
      out.x = x;
      out.y = y * cosT - z * sinT;
      out.z = y * sinT + z * cosT;
    },
    color(i, p, out) {
      const c = p[i * PARAM_STRIDE + 3];
      if (c >= 2) mix(out, G_PINK, G_INNER, c - 2);
      else if (c < 0.2) mix(out, G_CORE, G_INNER, c / 0.2);
      else mix(out, G_INNER, G_OUTER, (c - 0.2) / 0.8);
    },
  };
}

/* ------------------------------------------------------------------ fire */

const F_CORE = hex(0xfff3b8);
const F_YELLOW = hex(0xffb000);
const F_ORANGE = hex(0xff5200);
const F_RED = hex(0xb81600);

function fire(): ElementDef {
  let t = 0;
  const hOf = (p: Float32Array, o: number) => {
    const v = p[o] + t * (0.16 + 0.2 * p[o + 3]);
    return v - Math.floor(v);
  };
  return {
    name: "fire",
    label: "Fire",
    accent: "#ff7a1a",
    spring: 3.2,
    turbulence: 1.6,
    seed(p, count, rand) {
      for (let i = 0; i < count; i++) {
        const o = i * PARAM_STRIDE;
        p[o] = rand();
        p[o + 1] = rand() * TAU;
        p[o + 2] = Math.sqrt(rand());
        p[o + 3] = rand();
      }
    },
    begin(time) {
      t = time;
    },
    home(i, p, out) {
      const o = i * PARAM_STRIDE;
      const h = hOf(p, o);
      const ember = p[o + 3] > 0.9;
      // teardrop: narrow base, wide belly, pointed tip; embers fly higher and wider
      const belly = Math.sin(Math.PI * Math.min(1, h * 0.92 + 0.1));
      const width = ember ? 3.2 * h : 3.1 * Math.pow(belly, 0.7) * Math.pow(1 - h, 0.55);
      const ang = p[o + 1] + h * 2.4;
      const r = p[o + 2] * width;
      // tongues of flame: neighbours in angle lick upward at different times
      const lick = Math.sin(p[o + 1] * 3 + t * 3.1) * 0.35 * h;
      const sway = Math.sin(h * 4.5 + t * 2.3 + p[o + 3] * 2) * 0.5 * h * h;
      out.x = Math.cos(ang) * r + sway;
      out.y = -4.3 + h * (ember ? 10 : 8.4) + lick;
      out.z = Math.sin(ang) * r;
    },
    color(i, p, out) {
      const o = i * PARAM_STRIDE;
      const h = hOf(p, o);
      // hottest in the middle near the bottom, red at the edges and the top
      const heat = Math.max(0, 1 - h * 1.25 - p[o + 2] * 0.55);
      if (heat > 0.6) mix(out, F_YELLOW, F_CORE, (heat - 0.6) / 0.4);
      else if (heat > 0.3) mix(out, F_ORANGE, F_YELLOW, (heat - 0.3) / 0.3);
      else mix(out, F_RED, F_ORANGE, heat / 0.3);
      const fade = (h > 0.6 ? Math.max(0, 1 - (h - 0.6) / 0.4) : 1) * (p[o + 3] > 0.9 ? 1.4 : 0.85);
      out.x *= fade;
      out.y *= fade;
      out.z *= fade;
    },
  };
}

/* ------------------------------------------------------------------- ice */

const I_WHITE = hex(0xffffff);
const I_CYAN = hex(0x9fe9ff);
const I_BLUE = hex(0x3d8cff);

function ice(): ElementDef {
  let t = 0;
  let cosZ = 1;
  let sinZ = 0;
  let cosY = 1;
  let sinY = 0;
  return {
    name: "ice",
    label: "Ice",
    accent: "#7fdcff",
    spring: 2.6,
    turbulence: 0.15,
    seed(p, count, rand) {
      const branchAt = [0.95, 1.65, 2.35, 3.05];
      for (let i = 0; i < count; i++) {
        const o = i * PARAM_STRIDE;
        const arm = Math.floor(rand() * 6);
        const pick = rand();
        let lx: number;
        let ly: number;
        if (pick < 0.42) {
          lx = rand() * 3.9;
          ly = gauss(rand) * 0.03;
        } else if (pick < 0.95) {
          const at = branchAt[Math.floor(rand() * branchAt.length)];
          const len = (4.1 - at) * 0.45 * rand();
          const dir = (rand() < 0.5 ? -1 : 1) * (Math.PI / 3);
          lx = at + Math.cos(dir) * len;
          ly = Math.sin(dir) * len + gauss(rand) * 0.02;
        } else {
          const a = rand() * TAU;
          lx = Math.cos(a) * 0.75;
          ly = Math.sin(a) * 0.75;
        }
        const a = (arm * Math.PI) / 3;
        p[o] = lx * Math.cos(a) - ly * Math.sin(a);
        p[o + 1] = lx * Math.sin(a) + ly * Math.cos(a);
        p[o + 2] = gauss(rand) * 0.05;
        p[o + 3] = Math.min(1, Math.hypot(lx, ly) / 3.9);
      }
    },
    begin(time) {
      t = time;
      cosZ = Math.cos(time * 0.06);
      sinZ = Math.sin(time * 0.06);
      const wobble = Math.sin(time * 0.35) * 0.45;
      cosY = Math.cos(wobble);
      sinY = Math.sin(wobble);
    },
    home(i, p, out) {
      const o = i * PARAM_STRIDE;
      const x = p[o] * cosZ - p[o + 1] * sinZ;
      const y = p[o] * sinZ + p[o + 1] * cosZ;
      const z = p[o + 2];
      out.x = x * cosY + z * sinY;
      out.y = y;
      out.z = -x * sinY + z * cosY;
    },
    color(i, p, out) {
      const c = p[i * PARAM_STRIDE + 3];
      if (c < 0.4) mix(out, I_WHITE, I_CYAN, c / 0.4);
      else mix(out, I_CYAN, I_BLUE, (c - 0.4) / 0.6);
      const twinkle = 0.65 + 0.35 * Math.sin(t * 2.6 + i * 1.7);
      out.x *= twinkle;
      out.y *= twinkle;
      out.z *= twinkle;
    },
  };
}

/* --------------------------------------------------------------- rainbow */

function rainbow(): ElementDef {
  let t = 0;
  let cosR = 1;
  let sinR = 0;
  let cosW = 1;
  let sinW = 0;
  const tilt = 0.3;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  return {
    name: "rainbow",
    label: "Rainbow",
    accent: "#ff5fd2",
    spring: 2.4,
    turbulence: 0.4,
    seed(p, count, rand) {
      for (let i = 0; i < count; i++) {
        const o = i * PARAM_STRIDE;
        p[o] = rand() * TAU;
        p[o + 1] = gauss(rand) * 0.11;
        p[o + 2] = gauss(rand) * 0.11;
        p[o + 3] = gauss(rand) * 0.11;
      }
    },
    begin(time) {
      t = time;
      // spin in its own plane so the three-leaf knot always shows, with a slow wobble
      cosR = Math.cos(time * 0.2);
      sinR = Math.sin(time * 0.2);
      const wobble = Math.sin(time * 0.4) * 0.35;
      cosW = Math.cos(wobble);
      sinW = Math.sin(wobble);
    },
    home(i, p, out) {
      const o = i * PARAM_STRIDE;
      const u = p[o] + t * 0.22;
      // (2,3) torus knot
      const r = 2.6 + 1.15 * Math.cos(3 * u);
      const x0 = r * Math.cos(2 * u) + p[o + 1];
      const y0 = r * Math.sin(2 * u) + p[o + 2];
      const z0 = 1.0 * Math.sin(3 * u) + p[o + 3];
      const x = x0 * cosR - y0 * sinR;
      const y = x0 * sinR + y0 * cosR;
      const y1 = y * cosT - z0 * sinT;
      const z1 = y * sinT + z0 * cosT;
      out.x = x * cosW + z1 * sinW;
      out.y = y1;
      out.z = -x * sinW + z1 * cosW;
    },
    color(i, p, out) {
      const u = p[i * PARAM_STRIDE] / TAU + t * 0.06;
      hsl(out, u - Math.floor(u), 1, 0.5);
      out.x *= 0.8;
      out.y *= 0.8;
      out.z *= 0.8;
    },
  };
}

export function createElements(): Record<ElementName, ElementDef> {
  return { galaxy: galaxy(), fire: fire(), ice: ice(), rainbow: rainbow() };
}
