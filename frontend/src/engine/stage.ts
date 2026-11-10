import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * The shared 3D stage of every world: renderer, camera, star sky and the bloom glow.
 * Worlds add their own objects to `scene`.
 */

export const CAMERA_Z = 10;
export const FOV = 60;

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

export interface StageOptions {
  /** Upper limit for the device pixel ratio (lower = faster). */
  maxPixelRatio?: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly starfield: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Half the visible width and height at depth 0, in world units. */
  halfW = 1;
  halfH = 1;

  private pointMaterials: THREE.ShaderMaterial[] = [];
  private maxPixelRatio: number;

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: StageOptions = {},
  ) {
    this.maxPixelRatio = options.maxPixelRatio ?? 1.5;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    // Our colors are written as they should look on screen. Without this the bloom pass
    // converts them to sRGB a second time and everything turns pale and grey-blue.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color().setRGB(3 / 255, 3 / 255, 10 / 255, THREE.LinearSRGBColorSpace), 1);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camera.position.z = CAMERA_Z;

    this.starfield = this.createStarfield(mulberry32(11));
    this.scene.add(this.starfield);

    // 8-bit buffer on purpose: thousands of overlapping particles are clipped at white
    // before the bloom, otherwise the glow grows into a huge white disc.
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.15, 0.28);
    // weaker wide blur levels: keeps the glow near the light instead of a haze over the whole sky
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.75, 0.4, 0.12, 0.03];
    this.composer.addPass(this.bloom);
    this.resize();
  }

  /** Glowing dot material (additive). Its point size follows the screen size. */
  pointMaterial(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uScale: { value: this.pointScale() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pointMaterials.push(material);
    return material;
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.halfH = Math.tan(((FOV / 2) * Math.PI) / 180) * CAMERA_Z;
    this.halfW = this.halfH * this.camera.aspect;
    const scale = this.pointScale();
    for (const m of this.pointMaterials) m.uniforms.uScale.value = scale;
  }

  /** Screen position (0..1, y down) to world position at depth 0. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - 0.5) * 2 * this.halfW, y: (0.5 - sy) * 2 * this.halfH };
  }

  render(): void {
    this.composer.render();
  }

  /** The current picture as a data URL. */
  capture(type = "image/jpeg", quality = 0.92): string {
    this.render();
    return this.canvas.toDataURL(type, quality);
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

  private pointScale(): number {
    const height = Math.max(1, this.canvas.clientHeight) * Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    return height / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
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
    const points = new THREE.Points(geometry, this.pointMaterial());
    points.frustumCulled = false;
    return points;
  }
}
