import * as THREE from "three";

/** Short-lived sparks that spray from the pen and fall a little. */
export class Sparks {
  readonly object: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private next = 0;

  constructor(
    material: THREE.ShaderMaterial,
    private readonly max = 900,
  ) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.object = new THREE.Points(geometry, material);
    this.object.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, color: THREE.Color, count: number, speed = 1.6): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.sin(b) * Math.cos(a) * s;
      this.vel[i * 3 + 1] = Math.cos(b) * s + 0.4;
      this.vel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * s;
      const white = 0.4 + Math.random() * 0.4;
      this.base[i * 3] = color.r * (1 - white) + white;
      this.base[i * 3 + 1] = color.g * (1 - white) + white;
      this.base[i * 3 + 2] = color.b * (1 - white) + white;
      this.maxLife[i] = 0.4 + Math.random() * 0.7;
      this.life[i] = this.maxLife[i];
      this.size[i] = 0.04 + Math.random() * 0.06;
    }
  }

  step(dt: number): void {
    const drag = Math.pow(0.9, dt * 60);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= 2.2 * dt;
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= drag;
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
        this.col[i * 3 + k] = this.base[i * 3 + k] * f;
      }
    }
    const g = this.object.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}
