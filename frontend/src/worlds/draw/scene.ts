import * as THREE from "three";
import { HandOverlay } from "../../engine/handOverlay";
import { SculptureData, SculptureMesh } from "../../engine/sculpture";
import { Sparks } from "../../engine/sparks";
import { Stage } from "../../engine/stage";

/** Turning speeds in radians per second. */
export const SPIN = { drawing: 0.55, idle: 0.16, calmDrawing: 0.3, calmIdle: 0.08 };

/**
 * Air Drawing scene: the light sculpture sits on a slowly turning platform, like clay on a
 * potter's wheel. Lines are drawn on the flat plane facing you; because the sculpture turns
 * underneath the pen, the lines become real 3D shapes.
 */
export class DrawScene {
  readonly stage: Stage;
  readonly data = new SculptureData();
  readonly sparks: Sparks;
  readonly overlay: HandOverlay;
  /** Everything that turns: the drawing and the platform. */
  readonly group = new THREE.Group();

  /** Tilt toward you and turn around the vertical axis. */
  rotX = 0.22;
  rotY = 0;
  /** Current turning speed. Follows targetSpin unless a hand holds the sculpture. */
  spin = SPIN.idle;
  targetSpin = SPIN.idle;
  grabbed = false;
  targetScale = 1;
  calm = false;

  private mesh: SculptureMesh;
  private scale = 1;
  private baseScale = 1;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.mesh = new SculptureMesh(this.data, this.stage.pointMaterial());
    this.group.add(this.mesh.object, this.createPlatform());
    this.stage.scene.add(this.group);
    this.sparks = new Sparks(this.stage.pointMaterial());
    this.stage.scene.add(this.sparks.object);
    this.overlay = new HandOverlay(this.stage.pointMaterial());
    this.stage.scene.add(this.overlay.group);
    this.resize();
  }

  resize(): void {
    this.stage.resize();
    this.baseScale = Math.min(1, Math.max(0.45, this.stage.aspect / 1.3));
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return this.stage.toWorld(sx, sy);
  }

  /** A point on the drawing plane (world, depth 0) in sculpture coordinates. */
  toSculpture(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateMatrixWorld();
    return this.group.worldToLocal(out.set(x, y, 0));
  }

  step(dt: number): void {
    this.time += dt;
    if (!this.grabbed) {
      this.spin += (this.targetSpin - this.spin) * (1 - Math.exp(-dt * 1.5));
      this.rotY += this.spin * dt;
    }
    this.scale += (this.targetScale - this.scale) * (1 - Math.exp(-dt * 6));
    this.group.rotation.set(this.rotX, this.rotY, 0);
    this.group.scale.setScalar(this.scale * this.baseScale);
    this.mesh.sync();
    this.sparks.step(dt);
    this.stage.starfield.rotation.z = this.time * 0.004;
    this.stage.bloom.strength = this.calm ? 0.6 : 0.95;
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

  /** Faint rings of dots under the drawing, so you can see it turn. */
  private createPlatform(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const y = -3.4;
    const dot = (x: number, z: number, b: number, s: number) => {
      pos.push(x, y, z);
      col.push(0.35 * b, 0.4 * b, 0.9 * b);
      size.push(s);
    };
    for (const [r, n] of [
      [1.2, 40],
      [2.3, 80],
      [3.4, 130],
    ]) {
      for (let i = 0; i < n; i++) dot(Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r, 0.45, 0.05);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (let r = 0.3; r < 3.4; r += 0.22) dot(Math.cos(a) * r, Math.sin(a) * r, 0.25, 0.035);
    }
    dot(0, 0, 1, 0.12);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    const points = new THREE.Points(geometry, this.stage.pointMaterial());
    points.frustumCulled = false;
    return points;
  }
}
