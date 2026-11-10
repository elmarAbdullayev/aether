import * as THREE from "three";
import { mulberry32, Stage } from "../../engine/stage";
import { BAND_COUNT, type VoiceFrame } from "../../voice/voiceAnalyser";
import { textToPoints } from "./words";

export type Weather = "rain" | "snow" | "moon" | "storm";

const COLS = 97;
const ROWS = 80;
const SPACING = 1;
const NEAR_Z = 8;
const HALF_WIDTH = 24;
const CAMERA = new THREE.Vector3(0, 2.4, 10);

const SKY_VERTEX = /* glsl */ `
  varying float vY;
  void main() {
    vY = (modelMatrix * vec4(position, 1.0)).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uTop;
  uniform float uFlash;
  varying float vY;
  void main() {
    float t = pow(clamp(vY / 45.0, 0.0, 1.0), 0.55);
    // a soft glow at the horizon, kept dim: a bright sky would bloom into a white band
    vec3 col = mix(uHorizon * 0.4, uTop, t);
    gl_FragColor = vec4(col + vec3(uFlash), 1.0);
  }
`;
const DISC_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/** Retro sun: warm gradient with horizontal gaps that widen toward the bottom. */
const SUN_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float y = vUv.y;
    if (y < 0.55) {
      float band = fract(y * 11.0 + uTime * 0.12);
      if (band < (0.55 - y) * 1.3) discard;
    }
    gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.1, 0.95, y)) * 0.5, 1.0);
  }
`;
const MOON_FRAGMENT = /* glsl */ `
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float craters = 0.9 - 0.12 * smoothstep(0.08, 0.0, length(p - vec2(0.12, 0.08)))
                        - 0.1 * smoothstep(0.06, 0.0, length(p - vec2(-0.15, -0.1)))
                        - 0.08 * smoothstep(0.05, 0.0, length(p - vec2(0.05, -0.2)));
    gl_FragColor = vec4(vec3(0.92, 0.94, 1.0) * craters * 0.6, uAlpha);
  }
`;

interface Word {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  vel: Float32Array | null;
  age: number;
  dying: number;
  base: Float32Array;
}

/**
 * Voice World: you fly over a neon landscape. Every new row of hills at the horizon is the
 * shape of your voice (low notes in the middle, high notes outside, loud = high).
 */
export class VoiceScene {
  readonly stage: Stage;
  calm = false;

  private heights = new Float32Array(ROWS * COLS);
  private grid = new Float32Array(ROWS * COLS * 3);
  private lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private offset = 0;
  private time = 0;
  private sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private sun: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private moon: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private moonState = { until: 0, y: -8 };
  private horizon = new THREE.Color(0.75, 0.2, 0.85);
  private top = new THREE.Color(0.12, 0.04, 0.3);
  private target = { horizon: new THREE.Color(0.75, 0.2, 0.85), top: new THREE.Color(0.12, 0.04, 0.3) };
  private sunScale = 1;
  private latest: VoiceFrame | null = null;
  private weatherPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private weatherVel: Float32Array;
  private weather = { kind: "rain" as "rain" | "snow", level: 0, until: 0 };
  private bolt: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private flashes: number[] = [];
  private flash = 0;
  private words: Word[] = [];
  private look = new THREE.Vector2();
  private lookTarget = new THREE.Vector2();
  private rand = mulberry32(9);
  private tmp = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    const scene = this.stage.scene;
    this.stage.starfield.visible = false;
    this.stage.camera.position.copy(CAMERA);

    // sky, sun, moon, stars, ground (far to near)
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 220),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: { uHorizon: { value: this.horizon }, uTop: { value: this.top }, uFlash: { value: 0 } },
        depthWrite: false,
      }),
    );
    this.sky.position.set(0, 70, -110);
    this.sky.renderOrder = -2;
    scene.add(this.sky);
    scene.add(this.createStars());

    this.sun = new THREE.Mesh(
      new THREE.CircleGeometry(17, 96),
      new THREE.ShaderMaterial({
        vertexShader: DISC_VERTEX,
        fragmentShader: SUN_FRAGMENT,
        uniforms: {
          uTop: { value: new THREE.Color(1, 0.86, 0.3) },
          uBottom: { value: new THREE.Color(1, 0.18, 0.55) },
          uTime: { value: 0 },
        },
      }),
    );
    this.sun.position.set(0, 8, -100);
    scene.add(this.sun);

    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 64),
      new THREE.ShaderMaterial({
        vertexShader: DISC_VERTEX,
        fragmentShader: MOON_FRAGMENT,
        uniforms: { uAlpha: { value: 1 } },
        transparent: true,
      }),
    );
    this.moon.position.set(-34, -8, -104);
    scene.add(this.moon);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 260), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.9, -100);
    scene.add(ground);

    // the neon grid
    const segments = ROWS * (COLS - 1) + COLS * (ROWS - 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segments * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segments * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
    scene.add(this.lines);

    // rain and snow
    const n = 2400;
    const wpos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      wpos[i * 3] = (this.rand() - 0.5) * 50;
      wpos[i * 3 + 1] = this.rand() * 22;
      wpos[i * 3 + 2] = -55 + this.rand() * 63;
    }
    this.weatherVel = new Float32Array(n).map(() => 0.7 + this.rand() * 0.6);
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute("position", new THREE.BufferAttribute(wpos, 3).setUsage(THREE.DynamicDrawUsage));
    wgeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    wgeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n).fill(0.07), 1).setUsage(THREE.DynamicDrawUsage));
    this.weatherPoints = new THREE.Points(wgeo, this.stage.pointMaterial());
    this.weatherPoints.frustumCulled = false;
    scene.add(this.weatherPoints);

    // lightning bolt
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(60 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.bolt = new THREE.LineSegments(
      boltGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.bolt.frustumCulled = false;
    scene.add(this.bolt);

    this.resize();
  }

  resize(): void {
    this.stage.resize();
  }

  /** Mouse position 0..1: look a little around. */
  setLook(x: number, y: number): void {
    this.lookTarget.set((x - 0.5) * 2, (y - 0.5) * 2);
  }

  /** The newest microphone reading. */
  feed(frame: VoiceFrame | null): void {
    this.latest = frame;
  }

  addWord(text: string): void {
    const clean = text.trim().slice(0, 28);
    if (!clean) return;
    if (this.words.length >= 6) this.words[0].dying = Math.max(this.words[0].dying, 0.01);
    const xy = textToPoints(clean);
    const n = xy.length / 2;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, xy[i * 2]);
      maxX = Math.max(maxX, xy[i * 2]);
    }
    for (let i = 0; i < n; i++) {
      pos[i * 3] = xy[i * 2];
      pos[i * 3 + 1] = xy[i * 2 + 1];
      const t = (xy[i * 2] - minX) / Math.max(0.01, maxX - minX);
      this.tmp.copy(this.horizon).lerp(new THREE.Color(0.6, 1, 1), t * 0.7);
      col[i * 3] = this.tmp.r * 0.9 + 0.1;
      col[i * 3 + 1] = this.tmp.g * 0.9 + 0.1;
      col[i * 3 + 2] = this.tmp.b * 0.9 + 0.1;
      size[i] = 0.09;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const points = new THREE.Points(geometry, this.stage.pointMaterial());
    points.frustumCulled = false;
    // beside or above the sun, so the letters stay readable
    const side = this.rand() < 0.5 ? -1 : 1;
    points.position.set(side * (5 + this.rand() * 7), 8 + this.rand() * 4, -60);
    this.stage.scene.add(points);
    this.words.push({ points, vel: null, age: 0, dying: 0, base: col.slice() });
  }

  setWeather(kind: Weather): void {
    const now = this.time;
    if (kind === "moon") {
      this.moonState.until = now + 40;
      return;
    }
    if (kind === "storm") {
      this.weather = { kind: "rain", level: this.weather.level, until: now + 14 };
      const base = now + 0.2;
      this.flashes.push(base, base + 0.35, base + 1.3, base + 4.5);
      return;
    }
    this.weather = { kind, level: this.weather.kind === kind ? this.weather.level : 0, until: now + 16 };
  }

  step(dt: number): void {
    this.time += dt;
    const t = this.time;
    const frame = this.latest;

    // --- colors follow the pitch: low voice = red and purple, high voice = blue and turquoise
    if (frame?.pitch) {
      const k = Math.min(1, Math.max(0, (Math.log2(frame.pitch) - Math.log2(110)) / (Math.log2(650) - Math.log2(110))));
      this.target.horizon.setRGB(1 - 0.8 * k, 0.2 + 0.65 * k, 0.45 + 0.55 * k);
      this.target.top.setRGB(0.25 - 0.2 * k, 0.04 + 0.08 * k, 0.32 + 0.1 * k);
    }
    const colorRate = 1 - Math.exp(-dt * (frame?.pitch ? 3 : 0.3));
    this.horizon.lerp(this.target.horizon, colorRate);
    this.top.lerp(this.target.top, colorRate);
    if (!frame?.pitch) {
      this.target.horizon.lerp(new THREE.Color(0.75, 0.2, 0.85), 1 - Math.exp(-dt * 0.15));
      this.target.top.lerp(new THREE.Color(0.12, 0.04, 0.3), 1 - Math.exp(-dt * 0.15));
    }

    // --- the sun grows with loudness
    const level = frame?.level ?? 0;
    this.sunScale += (1 + level * 0.45 - this.sunScale) * (1 - Math.exp(-dt * 8));
    this.sun.scale.setScalar(this.sunScale);
    this.sun.material.uniforms.uTime.value = t;
    const sunTop = this.sun.material.uniforms.uTop.value as THREE.Color;
    sunTop.setRGB(1, 0.8 + 0.1 * this.horizon.g, 0.3 + 0.2 * this.horizon.b);

    // --- fly forward; each new row at the horizon gets the shape of the voice
    this.offset += dt * (this.calm ? 4 : 7);
    while (this.offset >= SPACING) {
      this.offset -= SPACING;
      this.heights.copyWithin(0, COLS);
      this.writeHorizonRow(frame);
    }

    this.updateGrid(t);
    this.updateWeather(dt);
    this.updateMoon(dt);
    this.updateLightning(dt);
    this.updateWords(dt);

    this.look.lerp(this.lookTarget, 1 - Math.exp(-dt * 3));
    const cam = this.stage.camera;
    cam.position.set(CAMERA.x + this.look.x * 1.5, CAMERA.y - this.look.y * 0.6, CAMERA.z);
    cam.lookAt(this.look.x * 14, 1.2 - this.look.y * 6, -40);

    this.sky.material.uniforms.uFlash.value = this.flash * 0.14;
    this.stage.bloom.strength = (this.calm ? 0.55 : 0.8) + this.flash * 0.12;
  }

  render(): void {
    this.stage.render();
  }

  capture(): string {
    return this.stage.capture();
  }

  dispose(): void {
    this.stage.dispose();
  }

  /* ------------------------------------------------------------------- */

  private writeHorizonRow(frame: VoiceFrame | null): void {
    const row = (ROWS - 1) * COLS;
    const mid = (COLS - 1) / 2;
    const raw = new Float32Array(COLS);
    for (let c = 0; c < COLS; c++) {
      let h = 0;
      if (frame) {
        const d = Math.abs(c - mid) / mid;
        const band = frame.bands[Math.min(BAND_COUNT - 1, Math.floor(d * BAND_COUNT))];
        // the room is never fully silent: ignore the quiet part
        const voice = Math.max(0, (band - 0.3) / 0.7);
        h = Math.min(5, Math.pow(voice, 1.4) * 6 * (0.75 + this.rand() * 0.5));
      }
      raw[c] = h;
    }
    // soften: neighbours share a little, so mountains look like mountains and not spikes
    for (let c = 0; c < COLS; c++) {
      const a = raw[Math.max(0, c - 1)];
      const b = raw[Math.min(COLS - 1, c + 1)];
      this.heights[row + c] = raw[c] * 0.5 + (a + b) * 0.25;
    }
  }

  private updateGrid(t: number): void {
    const g = this.grid;
    const xStep = (HALF_WIDTH * 2) / (COLS - 1);
    for (let r = 0; r < ROWS; r++) {
      const z = NEAR_Z - r * SPACING + this.offset;
      for (let c = 0; c < COLS; c++) {
        const x = -HALF_WIDTH + c * xStep;
        // a calm sea of small waves; the voice heights stand on top of it
        const sea = 0.16 * Math.sin(x * 0.55 + t * 1.3 + z * 0.35) + 0.08 * Math.sin(z * 0.9 - t * 1.7 + x * 0.2);
        // mountains sink as they come close, as if you fly over them (they would block the view)
        const near = r < 16 ? 0.25 + 0.75 * (r / 16) : 1;
        const i = (r * COLS + c) * 3;
        g[i] = x;
        g[i + 1] = sea + this.heights[r * COLS + c] * near;
        g[i + 2] = z;
      }
    }

    const pos = this.lines.geometry.attributes.position.array as Float32Array;
    const col = this.lines.geometry.attributes.color.array as Float32Array;
    const line = this.horizon;
    let k = 0;
    const put = (r: number, c: number) => {
      const i = (r * COLS + c) * 3;
      pos[k] = g[i];
      pos[k + 1] = g[i + 1];
      pos[k + 2] = g[i + 2];
      const h = Math.min(1, this.heights[r * COLS + c] / 4.5);
      // far rows fade into the dark (there many lines fall on the same pixels and would turn
      // white), but tall mountains stay visible further away; the nearest rows fade out under the camera
      const near = 1 - r / ROWS;
      const fade = (Math.pow(near, 2) * (1 - h) + Math.pow(near, 0.9) * 0.7 * h) * Math.min(1, (r + this.offset) / 3);
      col[k] = (line.r * (1 - h) + 0.6 * h) * fade;
      col[k + 1] = (line.g * (1 - h) + 0.8 * h) * fade;
      col[k + 2] = (line.b * (1 - h) + 0.85 * h) * fade;
      k += 3;
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        put(r, c);
        put(r, c + 1);
      }
    }
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 1; r++) {
        put(r, c);
        put(r + 1, c);
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }

  private updateWeather(dt: number): void {
    const w = this.weather;
    const wanted = this.time < w.until ? 1 : 0;
    w.level += (wanted - w.level) * (1 - Math.exp(-dt * 1.2));
    const geometry = this.weatherPoints.geometry;
    const pos = geometry.attributes.position.array as Float32Array;
    const col = geometry.attributes.aColor.array as Float32Array;
    const size = geometry.attributes.aSize.array as Float32Array;
    const n = this.weatherVel.length;
    const active = Math.round(n * w.level * (this.calm ? 0.5 : 1));
    const rain = w.kind === "rain";
    for (let i = 0; i < active; i++) {
      const s = this.weatherVel[i];
      pos[i * 3 + 1] -= (rain ? 24 : 1.8) * s * dt;
      if (!rain) pos[i * 3] += Math.sin(this.time * 1.3 + i) * 0.6 * dt;
      if (pos[i * 3 + 1] < -0.5) {
        pos[i * 3 + 1] = 20 + this.rand() * 4;
        pos[i * 3] = (this.rand() - 0.5) * 50;
      }
      const b = rain ? 0.45 : 0.75;
      col[i * 3] = (rain ? 0.55 : 0.95) * b;
      col[i * 3 + 1] = (rain ? 0.75 : 0.97) * b;
      col[i * 3 + 2] = 1 * b;
      size[i] = rain ? 0.05 : 0.1;
    }
    geometry.setDrawRange(0, active);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  }

  private updateMoon(dt: number): void {
    const target = this.time < this.moonState.until ? 20 : -8;
    this.moonState.y += (target - this.moonState.y) * (1 - Math.exp(-dt * 0.6));
    this.moon.position.y = this.moonState.y;
    this.moon.visible = this.moonState.y > -6;
  }

  private updateLightning(dt: number): void {
    this.flash *= Math.exp(-dt * 7);
    const due = this.flashes.filter((f) => f <= this.time);
    if (due.length) {
      this.flashes = this.flashes.filter((f) => f > this.time);
      this.flash = this.calm ? 0.35 : 1;
      this.drawBolt();
      this.onThunder?.();
    }
    this.bolt.material.opacity = Math.min(1, this.flash * 1.4);
  }

  /** Called on each lightning flash (for the thunder sound). */
  onThunder: (() => void) | null = null;

  private drawBolt(): void {
    const pos = this.bolt.geometry.attributes.position.array as Float32Array;
    let x = (this.rand() - 0.5) * 50;
    let y = 30;
    const z = -70 - this.rand() * 15;
    let k = 0;
    for (let i = 0; i < 60 && y > 0; i++) {
      const nx = x + (this.rand() - 0.5) * 3;
      const ny = y - 0.8 - this.rand() * 1.2;
      pos[k++] = x;
      pos[k++] = y;
      pos[k++] = z;
      pos[k++] = nx;
      pos[k++] = ny;
      pos[k++] = z;
      x = nx;
      y = ny;
    }
    this.bolt.geometry.setDrawRange(0, k / 3);
    this.bolt.geometry.attributes.position.needsUpdate = true;
  }

  private updateWords(dt: number): void {
    for (const word of [...this.words]) {
      word.age += dt;
      const p = word.points;
      p.position.z += dt * (this.calm ? 6 : 9);
      p.lookAt(this.stage.camera.position);
      if (!word.dying && p.position.z > -4) word.dying = 0.01;
      if (!word.dying) continue;
      // fall apart into sparks
      const pos = p.geometry.attributes.position.array as Float32Array;
      const col = p.geometry.attributes.aColor.array as Float32Array;
      if (!word.vel) word.vel = new Float32Array(pos.length).map(() => (this.rand() - 0.5) * 6);
      word.dying += dt;
      const fade = Math.max(0, 1 - word.dying / 1.3);
      for (let i = 0; i < pos.length; i++) {
        pos[i] += word.vel[i] * dt;
        col[i] = word.base[i] * fade;
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.geometry.attributes.aColor.needsUpdate = true;
      if (fade <= 0) {
        this.stage.scene.remove(p);
        p.geometry.dispose();
        this.words.splice(this.words.indexOf(word), 1);
      }
    }
  }

  private createStars(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const n = 900;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (this.rand() - 0.5) * 320;
      pos[i * 3 + 1] = 6 + Math.pow(this.rand(), 0.7) * 70;
      pos[i * 3 + 2] = -108;
      const b = 0.25 + Math.pow(this.rand(), 3) * 0.7;
      col[i * 3] = b;
      col[i * 3 + 1] = b;
      col[i * 3 + 2] = b * 1.05;
      size[i] = 0.25 + this.rand() * 0.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const points = new THREE.Points(geometry, this.stage.pointMaterial());
    points.frustumCulled = false;
    return points;
  }
}
