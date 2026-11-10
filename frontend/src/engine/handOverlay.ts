import * as THREE from "three";
import { FINGERTIPS, HAND_LINKS } from "./hand";

const MAX_HANDS = 4;
const MAX_DOTS = MAX_HANDS * 22;

export interface Cursor {
  x: number;
  y: number;
  /** true while the pen is drawing: a big bright dot. */
  active: boolean;
}

/** Glowing hand skeletons plus a pen cursor, drawn on top of everything (world coordinates, depth 2). */
export class HandOverlay {
  readonly group = new THREE.Group();
  private dots: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private pos = new Float32Array(MAX_DOTS * 3);
  private col = new Float32Array(MAX_DOTS * 3);
  private size = new Float32Array(MAX_DOTS);

  constructor(material: THREE.ShaderMaterial) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    material.depthTest = false;
    this.dots = new THREE.Points(geometry, material);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 3;

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_HANDS * HAND_LINKS.length * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.group.add(this.lines, this.dots);
  }

  update(hands: { x: number; y: number }[][], cursors: Cursor[], color: THREE.Color): void {
    let n = 0;
    const put = (x: number, y: number, size: number, bright: number) => {
      if (n >= MAX_DOTS) return;
      this.pos[n * 3] = x;
      this.pos[n * 3 + 1] = y;
      this.pos[n * 3 + 2] = 2;
      this.col[n * 3] = bright * (0.55 + color.r * 0.5);
      this.col[n * 3 + 1] = bright * (0.55 + color.g * 0.5);
      this.col[n * 3 + 2] = bright * (0.55 + color.b * 0.5);
      this.size[n] = size;
      n++;
    };
    const linePos = this.lines.geometry.attributes.position.array as Float32Array;
    let l = 0;
    for (const hand of hands.slice(0, MAX_HANDS)) {
      hand.forEach((p, j) => put(p.x, p.y, FINGERTIPS.has(j) ? 0.2 : 0.1, FINGERTIPS.has(j) ? 0.8 : 0.45));
      if (hand.length !== 21) continue;
      for (const index of HAND_LINKS) {
        linePos[l++] = hand[index].x;
        linePos[l++] = hand[index].y;
        linePos[l++] = 2;
      }
    }
    for (const c of cursors) {
      put(c.x, c.y, c.active ? 0.45 : 0.3, c.active ? 1.3 : 0.5);
      if (c.active) put(c.x, c.y, 1.1, 0.25);
    }
    const g = this.dots.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, l / 3);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.material.color.copy(color).lerp(new THREE.Color(1, 1, 1), 0.45);
  }
}
