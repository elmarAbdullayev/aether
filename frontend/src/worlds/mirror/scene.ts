import * as THREE from "three";
import { mulberry32, Stage } from "../../engine/stage";

export type MirrorStyle = "particles" | "matrix" | "hologram";

export const STYLE_ORDER: MirrorStyle[] = ["particles", "matrix", "hologram"];

export const STYLES: Record<MirrorStyle, { label: string; accent: string }> = {
  particles: { label: "Particles", accent: "#b59cff" },
  matrix: { label: "Matrix", accent: "#3dff7a" },
  hologram: { label: "Hologram", accent: "#3dd8ff" },
};

/** The camera picture is read as a grid of this many columns; every cell becomes one light point. */
const COLS = 168;
const MAX_ROWS = 126;
const TRAIL = 22;

const VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aChar;
  uniform float uScale;
  varying vec3 vColor;
  varying float vChar;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;
    vColor = aColor;
    vChar = aChar;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uGlyphs;
  uniform float uLetters;
  varying vec3 vColor;
  varying float vChar;
  void main() {
    if (uLetters > 0.5) {
      // one letter from the 8 x 8 letter sheet
      vec2 cell = vec2(mod(vChar, 8.0), floor(vChar / 8.0));
      float a = texture2D(uGlyphs, (cell + gl_PointCoord) / 8.0).r;
      if (a < 0.08) discard;
      gl_FragColor = vec4(vColor, a);
    } else {
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c, c) * 4.0;
      if (d > 1.0) discard;
      gl_FragColor = vec4(vColor, pow(1.0 - d, 2.0));
    }
  }
`;

/** 64 letters (half-width katakana and digits, mirrored like in the films) on one texture. */
function createGlyphs(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const chars: string[] = [];
  for (let code = 0xff66; code <= 0xff9d && chars.length < 54; code++) chars.push(String.fromCharCode(code));
  chars.push(..."0123456789".split(""));
  ctx.fillStyle = "#fff";
  ctx.font = "bold 50px 'MS Gothic', 'Yu Gothic', 'Meiryo', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const x = (i % 8) * 64 + 32;
    const y = Math.floor(i / 8) * 64 + 34;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

type Mode = "live" | "dust" | "reform";

/**
 * Hologram Mirror: the camera picture becomes a grid of light points. Only cells where the
 * person is (segmentation mask) light up. Three styles shade the same points differently.
 */
export class HologramScene {
  readonly stage: Stage;
  style: MirrorStyle = "particles";
  calm = false;
  /** Share of the picture that is person (0..1). */
  coverage = 0;

  private rows = 95;
  private count: number;
  private home: Float32Array;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private chr: Float32Array;
  private vis: Float32Array;
  private dust: Float32Array;
  private seed: Float32Array;
  private rainPhase = new Float32Array(COLS);
  private rainSpeed = new Float32Array(COLS);
  private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private projector: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private group = new THREE.Group();
  private sampler: CanvasRenderingContext2D;
  private cell = 0.05;
  private mode: Mode = "live";
  private modeTime = 0;
  private time = 0;
  private glitch = { until: 0, next: 2, from: 0, to: 0, shift: 0 };
  private rand = mulberry32(5);

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    const n = COLS * MAX_ROWS;
    this.count = COLS * this.rows;
    this.home = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.chr = new Float32Array(n);
    this.vis = new Float32Array(n);
    this.dust = new Float32Array(n);
    this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.seed[i] = this.rand();
      this.chr[i] = Math.floor(this.rand() * 64);
    }
    for (let c = 0; c < COLS; c++) {
      this.rainPhase[c] = this.rand() * (MAX_ROWS + 30);
      this.rainSpeed[c] = 9 + this.rand() * 14;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aChar", new THREE.BufferAttribute(this.chr, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 900 }, uGlyphs: { value: createGlyphs() }, uLetters: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stage.trackPointMaterial(material);
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.projector = this.createProjector();
    this.group.add(this.points, this.projector);
    this.stage.scene.add(this.group);

    const sampler = document.createElement("canvas");
    this.sampler = sampler.getContext("2d", { willReadFrequently: true })!;
    this.setAspect(16 / 9);
  }

  /** Camera picture width / height. Rebuilds the grid. */
  setAspect(aspect: number): void {
    this.rows = Math.max(40, Math.min(MAX_ROWS, Math.round(COLS / aspect)));
    this.count = COLS * this.rows;
    this.sampler.canvas.width = COLS;
    this.sampler.canvas.height = this.rows;
    this.layout();
  }

  resize(): void {
    this.stage.resize();
    this.layout();
  }

  setStyle(style: MirrorStyle): void {
    this.style = style;
    this.points.material.uniforms.uLetters.value = style === "matrix" ? 1 : 0;
  }

  get dissolved(): boolean {
    return this.mode === "dust";
  }

  /** Blow the hologram apart into dust. */
  dissolve(): void {
    if (this.mode === "dust") return;
    this.mode = "dust";
    this.modeTime = 0;
    for (let i = 0; i < this.count; i++) {
      this.dust[i] = this.vis[i];
      const s = this.seed[i];
      this.vel[i * 3] = (s - 0.3) * 1.5;
      this.vel[i * 3 + 1] = (this.seed[(i * 7) % this.count] - 0.4) * 1.2;
      this.vel[i * 3 + 2] = (this.seed[(i * 13) % this.count] - 0.5) * 2;
    }
  }

  /** Bring the dust back together. */
  reform(): void {
    if (this.mode !== "dust") return;
    this.mode = "reform";
    this.modeTime = 0;
  }

  /** How long the current dust has been flying, in seconds. */
  get dustAge(): number {
    return this.mode === "dust" ? this.modeTime : 0;
  }

  /**
   * One frame. `mask` is the person probability from the segmenter (null = no segmentation:
   * then the whole picture is shown).
   */
  update(video: HTMLVideoElement | null, mask: { data: Float32Array; width: number; height: number } | null, dt: number): void {
    this.time += dt;
    this.modeTime += dt;
    if (this.mode === "reform" && this.modeTime > 1.8) this.mode = "live";
    const t = this.time;
    const rows = this.rows;
    const n = this.count;

    let pixels: Uint8ClampedArray | null = null;
    if (video && video.readyState >= 2) {
      this.sampler.drawImage(video, 0, 0, COLS, rows);
      pixels = this.sampler.getImageData(0, 0, COLS, rows).data;
    }

    // glitch bands for the hologram style
    const g = this.glitch;
    if (this.style === "hologram" && !this.calm && t > g.next) {
      g.from = Math.floor(this.rand() * rows);
      g.to = Math.min(rows, g.from + 2 + Math.floor(this.rand() * 10));
      g.shift = (this.rand() - 0.5) * 0.8;
      g.until = t + 0.08 + this.rand() * 0.12;
      g.next = t + 1.2 + this.rand() * 3;
    }
    const glitching = this.style === "hologram" && t < g.until;

    const follow = 1 - Math.exp(-dt * 22);
    const fade = 1 - Math.exp(-dt * 16);
    const damp = Math.pow(0.9, dt * 60);
    const dustFade = Math.exp(-dt * 0.55);
    let seen = 0;
    const depth = this.style === "particles" ? 1.5 : this.style === "hologram" ? 0.7 : 0;

    for (let i = 0; i < n; i++) {
      const r = (i / COLS) | 0;
      const c = i - r * COLS;
      // --- person or not (no camera yet: nothing to show)
      let m = video ? 1 : 0;
      if (mask && mask.width) {
        const mx = Math.min(mask.width - 1, (((c + 0.5) / COLS) * mask.width) | 0);
        const my = Math.min(mask.height - 1, (((r + 0.5) / rows) * mask.height) | 0);
        m = mask.data[my * mask.width + mx];
      } else if (mask) m = 0;
      const target = m < 0.35 ? 0 : m > 0.7 ? 1 : (m - 0.35) / 0.35;
      this.vis[i] += (target - this.vis[i]) * fade;
      if (this.vis[i] > 0.5) seen++;

      // --- camera color
      let red = 0;
      let green = 0;
      let blue = 0;
      if (pixels) {
        const p = i * 4;
        red = pixels[p] / 255;
        green = pixels[p + 1] / 255;
        blue = pixels[p + 2] / 255;
      }
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;

      // --- where the point belongs
      const i3 = i * 3;
      const hx = this.home[i3] + (glitching && r >= g.from && r < g.to ? g.shift : 0);
      const hy = this.home[i3 + 1];
      const hz = (luma - 0.45) * depth;

      if (this.mode === "dust") {
        const s = this.seed[i];
        this.vel[i3] += (1.3 + s * 2.2) * dt;
        this.vel[i3 + 1] += (0.5 + Math.sin(this.pos[i3] * 1.7 + t * 2 + s * 6) * 1.2) * dt;
        this.vel[i3 + 2] += Math.cos(this.pos[i3 + 1] * 1.3 + t * 1.5 + s * 4) * 0.8 * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        this.dust[i] *= dustFade;
      } else if (this.mode === "reform") {
        for (let k = 0; k < 3; k++) {
          const h = k === 0 ? hx : k === 1 ? hy : hz;
          this.vel[i3 + k] = (this.vel[i3 + k] + (h - this.pos[i3 + k]) * 14 * dt) * damp;
          this.pos[i3 + k] += this.vel[i3 + k] * dt;
        }
      } else {
        this.pos[i3] += (hx - this.pos[i3]) * follow;
        this.pos[i3 + 1] += (hy - this.pos[i3 + 1]) * follow;
        this.pos[i3 + 2] += (hz - this.pos[i3 + 2]) * follow;
      }

      // --- shading per style
      const v = this.mode === "dust" ? this.dust[i] : this.vis[i];
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let size = 0;
      if (v > 0.02) {
        if (this.style === "particles") {
          const b = 0.95 * v;
          cr = (red * 0.85 + 0.08) * b;
          cg = (green * 0.85 + 0.06) * b;
          cb = (blue * 0.85 + 0.12) * b;
          size = this.cell * (0.55 + luma * 0.45);
        } else if (this.style === "hologram") {
          const scan = 0.55 + 0.45 * Math.sin(hy * 30 - t * 7);
          const flicker = this.calm ? 1 : 0.88 + 0.12 * Math.sin(t * 41) * Math.sin(t * 17);
          const left = c > 0 ? this.vis[i - 1] : 0;
          const up = r > 0 ? this.vis[i - COLS] : 0;
          const rim = Math.min(1, (Math.abs(this.vis[i] - left) + Math.abs(this.vis[i] - up)) * 2.5);
          const b = (0.12 + luma * 0.95) * scan * flicker * v;
          const pink = glitching && r >= g.from && r < g.to;
          cr = (pink ? 0.9 : 0.15) * b + rim * 0.5;
          cg = (pink ? 0.25 : 0.75) * b + rim * 0.8;
          cb = 1.0 * b + rim * 0.9;
          size = this.cell * 0.85;
        } else {
          // matrix: falling columns of letters, brighter where the camera picture is bright
          const head = (this.rainPhase[c] + t * this.rainSpeed[c]) % (rows + 30);
          const d = head - r;
          const trail = d >= 0 && d < TRAIL ? 1 - d / TRAIL : 0;
          const b = (0.32 + 0.68 * trail) * (0.55 + 0.8 * luma) * v;
          const isHead = d >= 0 && d < 1;
          cr = isHead ? 0.75 * v : 0.12 * b;
          cg = isHead ? 1.0 * v : 1.0 * b;
          cb = isHead ? 0.8 * v : 0.35 * b;
          if (isHead || this.rand() < 0.015) this.chr[i] = Math.floor(this.rand() * 64);
          size = this.cell * 1.08;
        }
      }
      this.col[i3] = cr;
      this.col[i3 + 1] = cg;
      this.col[i3 + 2] = cb;
      this.size[i] = size;
    }
    this.coverage = seen / n;

    const geometry = this.points.geometry;
    geometry.setDrawRange(0, n);
    for (const name of ["position", "aColor", "aSize", "aChar"]) geometry.attributes[name].needsUpdate = true;

    const sway = this.calm ? 0.05 : this.style === "matrix" ? 0.07 : 0.22;
    this.group.rotation.y = Math.sin(t * 0.45) * sway;
    this.updateProjector(t);
    this.stage.starfield.rotation.z = t * 0.004;
    this.stage.bloom.strength = this.calm ? 0.55 : this.style === "matrix" ? 0.7 : 0.85;
  }

  render(): void {
    this.stage.render();
  }

  capture(): string {
    return this.stage.capture();
  }

  dispose(): void {
    this.points.material.uniforms.uGlyphs.value.dispose();
    this.stage.dispose();
  }

  /** Grid cells to world positions: as big as fits the screen, mirrored like a real mirror. */
  private layout(): void {
    const aspect = COLS / this.rows;
    let height = this.stage.halfH * 2 * 0.92;
    let width = height * aspect;
    if (width > this.stage.halfW * 2 * 0.96) {
      width = this.stage.halfW * 2 * 0.96;
      height = width / aspect;
    }
    this.cell = width / COLS;
    for (let i = 0; i < this.count; i++) {
      const r = (i / COLS) | 0;
      const c = i - r * COLS;
      this.home[i * 3] = ((COLS - 1) / 2 - c) * this.cell;
      this.home[i * 3 + 1] = ((this.rows - 1) / 2 - r) * (height / this.rows);
      this.home[i * 3 + 2] = 0;
    }
    const y = -height / 2 - 0.15;
    this.projector.position.set(0, y, 0);
    this.projector.scale.set(width * 0.22, 1, width * 0.22);
  }

  /** A glowing ring under the figure, like the projector of a hologram. */
  private createProjector(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const n = 180;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ring = i % 3;
      const r = 1 - ring * 0.25;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.35;
      size[i] = 0.07 - ring * 0.015;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const points = new THREE.Points(geometry, this.stage.pointMaterial());
    points.frustumCulled = false;
    return points;
  }

  private updateProjector(t: number): void {
    const accent = new THREE.Color(STYLES[this.style].accent);
    const col = this.projector.geometry.attributes.aColor as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    const n = arr.length / 3;
    for (let i = 0; i < n; i++) {
      const pulse = 0.35 + 0.25 * Math.sin(t * 3 + i * 0.35);
      arr[i * 3] = accent.r * pulse;
      arr[i * 3 + 1] = accent.g * pulse;
      arr[i * 3 + 2] = accent.b * pulse;
    }
    col.needsUpdate = true;
  }
}
