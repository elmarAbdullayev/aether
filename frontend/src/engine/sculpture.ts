import * as THREE from "three";

/**
 * A light sculpture: strokes drawn in the air. SculptureData is the pure data (easy to test
 * and to save); SculptureMesh turns it into glowing points.
 */

export type BrushColor = "rainbow" | "red" | "blue" | "green" | "gold";

export const BRUSH_ORDER: BrushColor[] = ["rainbow", "red", "blue", "green", "gold"];

export const BRUSHES: Record<BrushColor, { label: string; css: string }> = {
  rainbow: { label: "Rainbow", css: "#ff5fd2" },
  red: { label: "Red", css: "#ff2d55" },
  blue: { label: "Blue", css: "#2f9bff" },
  green: { label: "Green", css: "#2dff8a" },
  gold: { label: "Gold", css: "#ffc21a" },
};

export interface SculptureJSON {
  version: 1;
  strokes: { color: BrushColor; points: number[] }[];
}

/** Distance between two points of a line, in sculpture units. */
export const SPACING = 0.03;
/** Upper limit, so a sculpture always stays fast and small enough to save. */
export const MAX_POINTS = 40000;
/** A jump longer than this (a tracking glitch) starts a new stroke instead of a long straight line. */
const MAX_JUMP = 2.5;

export interface StrokeInfo {
  color: BrushColor;
  start: number;
  count: number;
}

export class SculptureData {
  readonly points = new Float32Array(MAX_POINTS * 3);
  readonly strokes: StrokeInfo[] = [];
  count = 0;
  private current: StrokeInfo | null = null;

  get drawing(): boolean {
    return this.current !== null;
  }

  get full(): boolean {
    return this.count >= MAX_POINTS;
  }

  begin(color: BrushColor): void {
    this.end();
    this.current = { color, start: this.count, count: 0 };
    this.strokes.push(this.current);
  }

  /** Adds the pen position. Gaps are filled with evenly spaced points. Returns how many were added. */
  add(x: number, y: number, z: number): number {
    const stroke = this.current;
    if (!stroke || this.full) return 0;
    if (stroke.count === 0) return this.push(x, y, z);

    const o = (this.count - 1) * 3;
    let lx = this.points[o];
    let ly = this.points[o + 1];
    let lz = this.points[o + 2];
    const dx = x - lx;
    const dy = y - ly;
    const dz = z - lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > MAX_JUMP) {
      this.begin(stroke.color);
      return this.push(x, y, z);
    }
    const steps = Math.floor(d / SPACING);
    let added = 0;
    for (let k = 0; k < steps && !this.full; k++) {
      lx += (dx / d) * SPACING;
      ly += (dy / d) * SPACING;
      lz += (dz / d) * SPACING;
      added += this.push(lx, ly, lz);
    }
    return added;
  }

  /** Finishes the stroke. A stroke that is only a dot is dropped. */
  end(): void {
    const stroke = this.current;
    this.current = null;
    if (stroke && stroke.count < 2) {
      this.strokes.pop();
      this.count = stroke.start;
    }
  }

  undo(): boolean {
    this.end();
    const stroke = this.strokes.pop();
    if (!stroke) return false;
    this.count = stroke.start;
    return true;
  }

  clear(): void {
    this.current = null;
    this.strokes.length = 0;
    this.count = 0;
  }

  toJSON(): SculptureJSON {
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return {
      version: 1,
      strokes: this.strokes
        .filter((s) => s.count >= 2)
        .map((s) => ({
          color: s.color,
          points: Array.from(this.points.subarray(s.start * 3, (s.start + s.count) * 3), round),
        })),
    };
  }

  static fromJSON(json: SculptureJSON): SculptureData {
    const data = new SculptureData();
    for (const stroke of json.strokes) {
      const color = BRUSH_ORDER.includes(stroke.color) ? stroke.color : "rainbow";
      const info: StrokeInfo = { color, start: data.count, count: 0 };
      for (let i = 0; i + 2 < stroke.points.length && !data.full; i += 3) {
        const o = data.count * 3;
        data.points[o] = stroke.points[i];
        data.points[o + 1] = stroke.points[i + 1];
        data.points[o + 2] = stroke.points[i + 2];
        data.count++;
        info.count++;
      }
      if (info.count > 0) data.strokes.push(info);
    }
    return data;
  }

  private push(x: number, y: number, z: number): number {
    const o = this.count * 3;
    this.points[o] = x;
    this.points[o + 1] = y;
    this.points[o + 2] = z;
    this.count++;
    this.current!.count++;
    return 1;
  }
}

const FIXED: Record<Exclude<BrushColor, "rainbow">, THREE.Color> = {
  red: new THREE.Color(1, 0.18, 0.33),
  blue: new THREE.Color(0.18, 0.6, 1),
  green: new THREE.Color(0.18, 1, 0.54),
  gold: new THREE.Color(1, 0.76, 0.1),
};

/** Color of point `index` of stroke number `strokeIndex`. */
export function brushColor(color: BrushColor, strokeIndex: number, index: number, out = new THREE.Color()): THREE.Color {
  if (color === "rainbow") {
    const h = (strokeIndex * 0.17 + index * 0.004) % 1;
    return out.setHSL(h, 1, 0.55, THREE.LinearSRGBColorSpace);
  }
  return out.copy(FIXED[color]);
}

/**
 * Each point of the drawing becomes two glowing dots: a small bright core and a wide soft
 * glow. Together they look like a neon tube.
 */
export class SculptureMesh {
  readonly object: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private synced = 0;
  private syncedStrokes = 0;
  private pos = new Float32Array(MAX_POINTS * 2 * 3);
  private col = new Float32Array(MAX_POINTS * 2 * 3);
  private size = new Float32Array(MAX_POINTS * 2);
  private tmp = new THREE.Color();

  constructor(
    private readonly data: SculptureData,
    material: THREE.ShaderMaterial,
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.object = new THREE.Points(geometry, material);
    this.object.frustumCulled = false;
    this.sync();
  }

  /** Copies new points to the graphics card. Call once per frame. */
  sync(): void {
    const { data } = this;
    if (data.count < this.synced) {
      // undo or clear
      this.synced = data.count;
      this.syncedStrokes = Math.min(this.syncedStrokes, data.strokes.length);
    }
    if (data.count === this.synced) {
      this.object.geometry.setDrawRange(0, data.count * 2);
      return;
    }
    const from = this.synced;
    let s = Math.max(0, this.syncedStrokes - 1);
    for (let i = from; i < data.count; i++) {
      while (s < data.strokes.length - 1 && i >= data.strokes[s].start + data.strokes[s].count) s++;
      const stroke = data.strokes[s];
      brushColor(stroke.color, s, i - stroke.start, this.tmp);
      const jitter = ((i * 7919) % 13) / 13 - 0.5;
      const p = i * 3;
      const core = i * 2;
      const glow = core + 1;
      for (let k = 0; k < 3; k++) {
        this.pos[core * 3 + k] = data.points[p + k];
        this.pos[glow * 3 + k] = data.points[p + k] + jitter * 0.02;
      }
      this.col[core * 3] = this.tmp.r * 0.65 + 0.35;
      this.col[core * 3 + 1] = this.tmp.g * 0.65 + 0.35;
      this.col[core * 3 + 2] = this.tmp.b * 0.65 + 0.35;
      this.col[glow * 3] = this.tmp.r * 0.3;
      this.col[glow * 3 + 1] = this.tmp.g * 0.3;
      this.col[glow * 3 + 2] = this.tmp.b * 0.3;
      this.size[core] = 0.06;
      this.size[glow] = 0.22;
    }
    this.syncedStrokes = s + 1;
    const geometry = this.object.geometry;
    for (const name of ["position", "aColor", "aSize"] as const) {
      const attr = geometry.getAttribute(name) as THREE.BufferAttribute;
      // only the new part goes to the graphics card; ranges add up until the next render uploads them
      attr.addUpdateRange(from * 2 * attr.itemSize, (data.count - from) * 2 * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.synced = data.count;
    geometry.setDrawRange(0, data.count * 2);
  }

  /** Middle and size of the drawing, for framing it in the gallery viewer. */
  bounds(): THREE.Sphere {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < this.data.count; i++) box.expandByPoint(v.fromArray(this.data.points, i * 3));
    return box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
  }
}
