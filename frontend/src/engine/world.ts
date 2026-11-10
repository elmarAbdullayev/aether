import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { createElements, ELEMENT_ORDER, PARAM_STRIDE, type ElementDef, type ElementName, type Out3 } from "./elements";

/** A point that pulls particles into a swirl and drags them along (a fingertip). */
export interface Attractor {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A black hole made by a fist. charge grows from 0 to 1 while the fist is held. */
export interface BlackHole {
  x: number;
  y: number;
  charge: number;
}

/** A bright star you can grab with a pinch and throw. */
export interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  held: boolean;
  /** Seconds left after it was thrown. */
  life: number;
  trail: Float32Array;
  trailHead: number;
}

export interface WorldOptions {
  count?: number;
  /** Smaller and calmer, for the start page background. */
  ambient?: boolean;
}

const MAX_STARS = 6;
const TRAIL = 28;
const MAX_FX = 420;
const MAX_HAND_LINES = 4 * 21;
const HAND_LINKS = [
  0, 1, 1, 2, 2, 3, 3, 4, 0, 5, 5, 6, 6, 7, 7, 8, 5, 9, 9, 10, 10, 11, 11, 12, 9, 13, 13, 14, 14, 15, 15, 16, 13, 17,
  17, 18, 18, 19, 19, 20, 0, 17,
];
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);
const CAMERA_Z = 10;
const FOV = 60;

const POINT_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, aSize * uScale / -mv.z);
    vColor = aColor;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, pow(1.0 - d, 2.2));
  }
`;

const DISK_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISK_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uCharge;
  uniform vec3 uColor;
  varying vec2 vPos;
  void main() {
    float r = length(vPos);
    float t = clamp((r - 1.0) / 1.8, 0.0, 1.0);
    float ang = atan(vPos.y, vPos.x);
    float swirl = 0.5 + 0.5 * sin(ang * 5.0 - uTime * 6.0 + r * 7.0);
    float glow = pow(1.0 - t, 2.4) * (0.55 + 0.45 * swirl);
    vec3 col = mix(vec3(1.0, 0.95, 0.85), uColor, smoothstep(0.0, 0.6, t));
    gl_FragColor = vec4(col * 1.6, glow * uCharge);
  }
`;

/** Radius of the black sphere in world units. */
function holeRadius(charge: number): number {
  return 0.3 + 0.55 * charge;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: { uScale: { value: 900 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface HoleVisual {
  group: THREE.Group;
  disk: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shown: number;
}

interface Shockwave {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  power: number;
}

export class ParticleWorld {
  readonly canvas: HTMLCanvasElement;
  readonly attractors: Attractor[] = [];
  readonly holes: BlackHole[] = [];
  readonly stars: Star[] = [];
  /** Wanted zoom (two hands or mouse wheel). The real zoom follows smoothly. */
  targetScale = 1;
  calm = false;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  private count: number;
  private active: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private prevHome: Float32Array;
  private seeds: Float32Array;
  private params: Record<ElementName, Float32Array>;
  private elements: Record<ElementName, ElementDef>;
  private element: ElementDef;
  private homeReset = true;
  private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private fx: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fxPos = new Float32Array(MAX_FX * 3);
  private fxCol = new Float32Array(MAX_FX * 3);
  private fxSize = new Float32Array(MAX_FX);
  private handLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private hands: { x: number; y: number }[][] = [];

  private holeVisuals: HoleVisual[] = [];
  private shockwaves: Shockwave[] = [];
  private starfield: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private ambient: boolean;
  private time = 0;
  private scale = 1;
  private baseScale = 1;
  private halfW = 1;
  private halfH = 1;
  private release = 1;
  private shake = 0;
  private bloomKick = 0;
  private accent = new THREE.Color();
  private tmp: Out3 = { x: 0, y: 0, z: 0 };
  private slowFrames = 0;

  constructor(canvas: HTMLCanvasElement, options: WorldOptions = {}) {
    this.canvas = canvas;
    this.ambient = options.ambient ?? false;
    this.count = options.count ?? 22000;
    this.active = this.count;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    // Our colors are written as they should look on screen. Without this the bloom pass
    // converts them to sRGB a second time and everything turns pale and grey-blue.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color().setRGB(3 / 255, 3 / 255, 10 / 255, THREE.LinearSRGBColorSpace), 1);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camera.position.z = CAMERA_Z;

    const rand = mulberry32(7);
    this.elements = createElements();
    this.params = {} as Record<ElementName, Float32Array>;
    for (const name of ELEMENT_ORDER) {
      const p = new Float32Array(this.count * PARAM_STRIDE);
      this.elements[name].seed(p, this.count, rand);
      this.params[name] = p;
    }
    this.element = this.elements.galaxy;
    this.accent.set(this.element.accent);

    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.col = new Float32Array(this.count * 3);
    this.prevHome = new Float32Array(this.count * 3);
    this.seeds = new Float32Array(this.count);
    const sizes = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.seeds[i] = rand();
      sizes[i] = 0.028 + Math.pow(rand(), 4) * 0.1;
      // start as a wide cloud, so the first shape forms in front of you
      const r = 6 + rand() * 10;
      const a = rand() * Math.PI * 2;
      this.pos[i * 3] = Math.cos(a) * r;
      this.pos[i * 3 + 1] = (rand() - 0.5) * 12;
      this.pos[i * 3 + 2] = Math.sin(a) * r - 4;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.points = new THREE.Points(geometry, pointMaterial());
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.starfield = this.createStarfield(rand);
    this.scene.add(this.starfield);

    const fxGeometry = new THREE.BufferGeometry();
    fxGeometry.setAttribute("position", new THREE.BufferAttribute(this.fxPos, 3).setUsage(THREE.DynamicDrawUsage));
    fxGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.fxCol, 3).setUsage(THREE.DynamicDrawUsage));
    fxGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.fxSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.fx = new THREE.Points(fxGeometry, pointMaterial());
    this.fx.frustumCulled = false;
    this.fx.material.depthTest = false;
    this.fx.renderOrder = 3;
    this.scene.add(this.fx);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_HAND_LINES * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.handLines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.handLines.frustumCulled = false;
    this.handLines.renderOrder = 2;
    this.scene.add(this.handLines);

    for (let i = 0; i < 4; i++) this.holeVisuals.push(this.createHoleVisual());
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 128),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({ mesh, age: 99, power: 0 });
    }

    // 8-bit buffer on purpose: thousands of overlapping particles are clipped at white
    // before the bloom, otherwise the glow grows into a huge white disc.
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType }),
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.15, 0.28);
    // weaker wide blur levels: keeps the glow near the light instead of a haze over the whole sky
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.75, 0.4, 0.12, 0.03];
    this.composer.addPass(this.bloom);

    this.resize();
  }

  get elementName(): ElementName {
    return this.element.name;
  }

  get accentColor(): string {
    return this.element.accent;
  }

  /** Size of the visible area at depth 0, in world units. */
  get bounds(): { halfW: number; halfH: number } {
    return { halfW: this.halfW, halfH: this.halfH };
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.ambient ? 1.25 : 1.5);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.halfH = Math.tan(((FOV / 2) * Math.PI) / 180) * CAMERA_Z;
    this.halfW = this.halfH * this.camera.aspect;
    this.baseScale = Math.min(1, Math.max(0.42, this.camera.aspect / 1.3));
    const scale = (height * ratio) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    this.points.material.uniforms.uScale.value = scale;
    this.fx.material.uniforms.uScale.value = scale;
    this.starfield.material.uniforms.uScale.value = scale;
  }

  /** Screen position (0..1, y down) to world position at depth 0. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - 0.5) * 2 * this.halfW, y: (0.5 - sy) * 2 * this.halfH };
  }

  setElement(name: ElementName): void {
    if (name === this.element.name) return;
    this.element = this.elements[name];
    this.accent.set(this.element.accent);
    this.homeReset = true;
  }

  /** Skeleton points of each visible hand, already in world units. */
  setHands(hands: { x: number; y: number }[][]): void {
    this.hands = hands;
  }

  /** Pushes particles away from (x, y). local = a small pop that does not break the shape. */
  explode(x: number, y: number, power: number, local = false): void {
    const p = this.calm ? power * 0.6 : power;
    const { pos, vel, seeds } = this;
    const reach = local ? 2.8 : Infinity;
    for (let i = 0; i < this.active; i++) {
      const i3 = i * 3;
      const dx = pos[i3] - x;
      const dy = pos[i3 + 1] - y;
      const dz = pos[i3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.3;
      if (d > reach) continue;
      const s = seeds[i];
      const imp = ((p * (local ? 22 : 44)) / (d + 0.8)) * (0.55 + 0.9 * s) * (local ? 1 - d / reach : 1);
      vel[i3] += (dx / d) * imp;
      vel[i3 + 1] += (dy / d) * imp;
      vel[i3 + 2] += (dz / d + (s - 0.5) * 1.6) * imp * 0.9;
    }
    if (!local) this.release = Math.min(this.release, 0.04);
    if (!this.calm) this.shake = Math.max(this.shake, (local ? 0.08 : 0.4) * power);
    this.bloomKick = Math.max(this.bloomKick, (local ? 0.5 : 1.5) * p);
    const wave = this.shockwaves.find((w) => w.age > 1.2);
    if (wave) {
      wave.age = 0;
      wave.power = local ? 0.4 : Math.max(0.35, p);
      wave.mesh.position.set(x, y, 0.5);
      wave.mesh.material.color.copy(this.accent).lerp(new THREE.Color(1, 1, 1), 0.5);
      wave.mesh.visible = true;
    }
  }

  addStar(x: number, y: number): Star | null {
    if (this.stars.length >= MAX_STARS) {
      const free = this.stars.find((s) => !s.held);
      if (!free) return null;
      this.removeStar(free);
    }
    const trail = new Float32Array(TRAIL * 2);
    for (let i = 0; i < TRAIL; i++) {
      trail[i * 2] = x;
      trail[i * 2 + 1] = y;
    }
    const star: Star = { x, y, vx: 0, vy: 0, held: true, life: 5, trail, trailHead: 0 };
    this.stars.push(star);
    return star;
  }

  removeStar(star: Star): void {
    const at = this.stars.indexOf(star);
    if (at >= 0) this.stars.splice(at, 1);
  }

  /** Called when a free star's life ends. */
  onStarPop: ((star: Star) => void) | null = null;

  step(rawDt: number): void {
    const dt = Math.min(Math.max(rawDt, 0), 1 / 30);
    this.adaptQuality(rawDt);
    const speed = this.calm ? 0.55 : this.ambient ? 0.7 : 1;
    this.time += dt * speed;
    const el = this.element;
    el.begin(this.time);

    this.scale += (this.targetScale - this.scale) * (1 - Math.exp(-dt * 6));
    this.release = Math.min(1, this.release + dt * 0.55);
    let maxCharge = 0;
    for (const h of this.holes) maxCharge = Math.max(maxCharge, h.charge);
    const springMul = (0.03 + 0.97 * this.release * this.release) * (1 - 0.82 * maxCharge);
    const k = el.spring * springMul;
    const damp = Math.pow(0.935, dt * 60);
    const turb = el.turbulence * (this.calm ? 0.5 : 1);
    const colorRate = 1 - Math.exp(-dt * 4);
    const dragRate = Math.min(1, dt * 7);
    const s = this.scale * this.baseScale;
    const t = this.time;
    const reset = this.homeReset;
    this.homeReset = false;
    // a smaller shape packs the same particles tighter, so each one must glow less
    const brightness = (this.ambient ? 0.85 : 1) * Math.min(1, 0.3 + 0.7 * s);

    this.updateStars(dt);

    const { pos, vel, col, prevHome, seeds, tmp } = this;
    const params = this.params[el.name];
    const attractors = this.attractors;
    const holes = this.holes;
    const stars = this.stars;
    const AR = 2.4;
    const AR2 = AR * AR;
    const holeStrength = holes.map((h) => 30 * (0.25 + 1.75 * h.charge));
    const holeRing = holes.map((h) => holeRadius(h.charge) * 1.7);

    for (let i = 0; i < this.active; i++) {
      const i3 = i * 3;
      el.home(i, params, tmp);
      const hx = tmp.x * s;
      const hy = tmp.y * s;
      const hz = tmp.z * s;
      let px = pos[i3];
      let py = pos[i3 + 1];
      let pz = pos[i3 + 2];
      let vx = vel[i3];
      let vy = vel[i3 + 1];
      let vz = vel[i3 + 2];

      if (!reset) {
        const jx = hx - prevHome[i3];
        const jy = hy - prevHome[i3 + 1];
        const jz = hz - prevHome[i3 + 2];
        if (jx * jx + jy * jy + jz * jz > 4) {
          // the shape wrapped around (fire rising): jump with it instead of flying through
          px = hx;
          py = hy;
          pz = hz;
          vx = vy = vz = 0;
        }
      }
      prevHome[i3] = hx;
      prevHome[i3 + 1] = hy;
      prevHome[i3 + 2] = hz;

      const sd = seeds[i];
      let ax = (hx - px) * k + Math.sin(py * 1.3 + t * 0.9 + sd * 6.28) * turb;
      let ay = (hy - py) * k + Math.cos(px * 1.2 + t * 0.7 + sd * 4.1) * turb;
      let az = (hz - pz) * k + Math.sin((px + py) * 0.8 + t * 0.6 + sd * 3.3) * turb * 0.6;

      for (let a = 0; a < attractors.length; a++) {
        const at = attractors[a];
        const dx = px - at.x;
        const dy = py - at.y;
        const d2 = dx * dx + dy * dy + pz * pz * 0.3;
        if (d2 > AR2) continue;
        const d = Math.sqrt(d2) + 1e-4;
        const f = 1 - d / AR;
        ax += ((-dx / d) * 14 - (dy / d) * 18) * f;
        ay += ((-dy / d) * 14 + (dx / d) * 18) * f;
        az -= pz * 6 * f;
        const f2 = f * f * dragRate;
        vx += (at.vx - vx) * f2;
        vy += (at.vy - vy) * f2;
      }

      let swallowed = 1;
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        const dx = px - hole.x;
        const dy = py - hole.y;
        const d2 = dx * dx + dy * dy + pz * pz * 4 + 0.05;
        const d = Math.sqrt(d2);
        const g = holeStrength[h] / (d2 + 0.45);
        const ring = holeRing[h];
        // pulled in and spun around, but a hard edge keeps a dark middle: the accretion ring
        const push = d < ring ? (ring - d) * 70 : 0;
        ax += (-dx / d) * (g - push) - (dy / d) * g * 0.75;
        ay += (-dy / d) * (g - push) + (dx / d) * g * 0.75;
        az -= pz * (g * 0.6 + 4);
        // thousands of particles crowd into the ring: dim them so it glows instead of turning white
        const near = Math.min(1, Math.max(0, (d - ring) / (ring * 3.5)));
        const dim = 0.14 + 0.86 * near * near;
        swallowed = Math.min(swallowed, d < ring * 0.8 ? (d / (ring * 0.8)) * 0.14 : dim);
      }

      for (let n = 0; n < stars.length; n++) {
        const st = stars[n];
        const R = st.held ? 1.5 : 1.9;
        const dx = px - st.x;
        const dy = py - st.y;
        const d2 = dx * dx + dy * dy + pz * pz * 0.5;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2) + 1e-4;
        const f = 1 - d / R;
        const pull = st.held ? 40 : 22;
        const swirl = st.held ? 28 : 10;
        ax += ((-dx / d) * pull - (dy / d) * swirl) * f;
        ay += ((-dy / d) * pull + (dx / d) * swirl) * f;
        az -= pz * 8 * f;
        if (!st.held) {
          const f2 = f * f * Math.min(1, dt * 5);
          vx += (st.vx - vx) * f2;
          vy += (st.vy - vy) * f2;
        }
      }

      vx = (vx + ax * dt) * damp;
      vy = (vy + ay * dt) * damp;
      vz = (vz + az * dt) * damp;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > 2025) {
        const m = 45 / Math.sqrt(v2);
        vx *= m;
        vy *= m;
        vz *= m;
      }
      pos[i3] = px + vx * dt;
      pos[i3 + 1] = py + vy * dt;
      pos[i3 + 2] = pz + vz * dt;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;

      el.color(i, params, tmp);
      const boost = (0.36 + Math.min(Math.sqrt(v2) * 0.045, 0.9)) * brightness * swallowed;
      col[i3] += (tmp.x * boost - col[i3]) * colorRate;
      col[i3 + 1] += (tmp.y * boost - col[i3 + 1]) * colorRate;
      col[i3 + 2] += (tmp.z * boost - col[i3 + 2]) * colorRate;
    }

    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.active);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;

    this.updateFx();
    this.updateHoles(dt);
    this.updateShockwaves(dt);

    this.starfield.rotation.z = t * 0.004;
    this.shake *= Math.pow(0.02, dt);
    this.camera.position.x = (Math.random() - 0.5) * this.shake;
    this.camera.position.y = (Math.random() - 0.5) * this.shake;
    this.bloomKick *= Math.pow(0.05, dt);
    const baseBloom = this.calm ? 0.6 : this.ambient ? 0.7 : 0.9;
    this.bloom.strength = baseBloom * (1 - 0.45 * maxCharge) + this.bloomKick;
  }

  render(): void {
    this.composer.render();
  }

  /** The current picture as a JPEG data URL. */
  capture(): string {
    this.render();
    return this.canvas.toDataURL("image/jpeg", 0.92);
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
  }

  /* --------------------------------------------------------------------------- */

  private adaptQuality(rawDt: number): void {
    // weaker laptops: use fewer particles instead of stuttering
    if (rawDt > 0.028 && rawDt < 0.25) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.active > 7000) {
      this.active = Math.floor(this.active * 0.8);
      this.slowFrames = 0;
    }
  }

  private updateStars(dt: number): void {
    const { halfW, halfH } = this;
    for (const star of [...this.stars]) {
      if (!star.held) {
        star.x += star.vx * dt;
        star.y += star.vy * dt;
        const drag = Math.pow(0.985, dt * 60);
        star.vx *= drag;
        star.vy *= drag;
        if (Math.abs(star.x) > halfW - 0.3) {
          star.x = Math.sign(star.x) * (halfW - 0.3);
          star.vx *= -0.85;
        }
        if (Math.abs(star.y) > halfH - 0.3) {
          star.y = Math.sign(star.y) * (halfH - 0.3);
          star.vy *= -0.85;
        }
        star.life -= dt;
        if (star.life <= 0) {
          this.removeStar(star);
          this.explode(star.x, star.y, 0.6, true);
          this.onStarPop?.(star);
          continue;
        }
      }
      star.trailHead = (star.trailHead + 1) % TRAIL;
      star.trail[star.trailHead * 2] = star.x;
      star.trail[star.trailHead * 2 + 1] = star.y;
    }
  }

  private updateFx(): void {
    const { fxPos, fxCol, fxSize, accent } = this;
    let n = 0;
    const put = (x: number, y: number, z: number, size: number, r: number, g: number, b: number) => {
      if (n >= MAX_FX) return;
      fxPos[n * 3] = x;
      fxPos[n * 3 + 1] = y;
      fxPos[n * 3 + 2] = z;
      fxCol[n * 3] = r;
      fxCol[n * 3 + 1] = g;
      fxCol[n * 3 + 2] = b;
      fxSize[n] = size;
      n++;
    };

    for (const star of this.stars) {
      const pulse = 1 + 0.15 * Math.sin(this.time * 9);
      const fade = star.held ? 1 : Math.min(1, star.life / 1.2);
      put(star.x, star.y, 1, 0.9 * pulse, 1.3 * fade, 1.25 * fade, 1.2 * fade);
      put(star.x, star.y, 1, 2.2, accent.r * 0.5 * fade, accent.g * 0.5 * fade, accent.b * 0.5 * fade);
      for (let k = 1; k < TRAIL; k++) {
        const idx = (star.trailHead - k + TRAIL) % TRAIL;
        const f = (1 - k / TRAIL) * fade;
        put(star.trail[idx * 2], star.trail[idx * 2 + 1], 1, 0.5 * f + 0.05, accent.r * f, accent.g * f, accent.b * f);
      }
    }

    const linePos = this.handLines.geometry.attributes.position.array as Float32Array;
    let l = 0;
    for (const hand of this.hands) {
      for (let j = 0; j < hand.length; j++) {
        const tip = FINGERTIPS.has(j);
        const c = tip ? 1 : 0.55;
        put(hand[j].x, hand[j].y, 2, tip ? 0.32 : 0.14, c * (0.6 + accent.r * 0.5), c * (0.6 + accent.g * 0.5), c * (0.6 + accent.b * 0.5));
      }
      if (hand.length === 21 && l + HAND_LINKS.length * 3 <= linePos.length) {
        for (let k = 0; k < HAND_LINKS.length; k++) {
          const p = hand[HAND_LINKS[k]];
          linePos[l++] = p.x;
          linePos[l++] = p.y;
          linePos[l++] = 2;
        }
      }
    }
    this.handLines.geometry.setDrawRange(0, l / 3);
    this.handLines.geometry.attributes.position.needsUpdate = true;
    this.handLines.material.color.copy(accent).lerp(new THREE.Color(1, 1, 1), 0.45);

    const geometry = this.fx.geometry;
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  }

  private createHoleVisual(): HoleVisual {
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    group.add(sphere);
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 2.9, 96, 1),
      new THREE.ShaderMaterial({
        vertexShader: DISK_VERTEX,
        fragmentShader: DISK_FRAGMENT,
        uniforms: { uTime: { value: 0 }, uCharge: { value: 0 }, uColor: { value: new THREE.Color() } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    disk.rotation.x = -1.2;
    group.add(disk);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.13, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(ring);
    group.visible = false;
    this.scene.add(group);
    return { group, disk, ring, shown: 0 };
  }

  private updateHoles(dt: number): void {
    this.holeVisuals.forEach((visual, i) => {
      const hole = this.holes[i];
      const target = hole ? 1 : 0;
      visual.shown += (target - visual.shown) * (1 - Math.exp(-dt * (hole ? 10 : 6)));
      if (visual.shown < 0.01 && !hole) {
        visual.group.visible = false;
        return;
      }
      visual.group.visible = true;
      if (hole) visual.group.position.set(hole.x, hole.y, 0);
      const charge = hole ? hole.charge : 0;
      const size = holeRadius(charge) * visual.shown;
      visual.group.scale.setScalar(Math.max(size, 0.001));
      const u = visual.disk.material.uniforms;
      u.uTime.value = this.time;
      u.uCharge.value = (0.35 + 0.9 * charge) * visual.shown;
      (u.uColor.value as THREE.Color).copy(this.accent);
      visual.ring.material.opacity = (0.4 + 0.6 * charge) * visual.shown;
      visual.ring.lookAt(this.camera.position);
    });
  }

  private updateShockwaves(dt: number): void {
    for (const wave of this.shockwaves) {
      if (!wave.mesh.visible) continue;
      wave.age += dt;
      const t = wave.age / 1.1;
      if (t >= 1) {
        wave.mesh.visible = false;
        continue;
      }
      const eased = 1 - Math.pow(1 - t, 3);
      wave.mesh.scale.setScalar(0.3 + eased * 11 * wave.power);
      wave.mesh.material.opacity = (1 - t) * 0.9;
    }
  }

  private createStarfield(rand: () => number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const n = 1600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rand() - 0.5) * 140;
      pos[i * 3 + 1] = (rand() - 0.5) * 90;
      pos[i * 3 + 2] = -30 - rand() * 40;
      const b = 0.22 + Math.pow(rand(), 3) * 0.6;
      const blue = rand() < 0.3;
      col[i * 3] = b * (blue ? 0.7 : 1);
      col[i * 3 + 1] = b * (blue ? 0.85 : 0.95);
      col[i * 3 + 2] = b;
      size[i] = 0.12 + rand() * 0.18;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const points = new THREE.Points(geometry, pointMaterial());
    points.frustumCulled = false;
    return points;
  }
}
