import { useEffect, useRef } from "react";
import { ELEMENT_ORDER } from "../engine/elements";
import { ParticleWorld } from "../engine/world";
import { useSettings } from "../settings";

/**
 * Living background for the start page: a smaller particle world that follows the
 * mouse and slowly morphs through the four elements.
 */
export function AmbientCanvas({ count = 12000, cycle = true }: { count?: number; cycle?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<ParticleWorld | null>(null);
  const { calm } = useSettings();

  useEffect(() => {
    const canvas = ref.current!;
    const world = new ParticleWorld(canvas, { count, ambient: true });
    worldRef.current = world;
    if (import.meta.env.DEV) (window as unknown as { __aether?: unknown }).__aether = { world };
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, at: -1e9, prevX: 0, prevY: 0 };
    let frame = 0;
    let last = 0;
    let elementAt = performance.now();
    let element = 0;

    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const p = world.toWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.at = performance.now();
    };
    const resize = () => world.resize();

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      if (dt > 0) {
        pointer.vx += ((pointer.x - pointer.prevX) / dt - pointer.vx) * 0.4;
        pointer.vy += ((pointer.y - pointer.prevY) / dt - pointer.vy) * 0.4;
      }
      pointer.prevX = pointer.x;
      pointer.prevY = pointer.y;
      world.attractors.length = 0;
      if (now - pointer.at < 2500) world.attractors.push({ x: pointer.x, y: pointer.y, vx: pointer.vx, vy: pointer.vy });
      if (cycle && now - elementAt > 9000) {
        elementAt = now;
        element = (element + 1) % ELEMENT_ORDER.length;
        world.setElement(ELEMENT_ORDER[element]);
      }
      world.step(dt);
      world.render();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", resize);
      world.dispose();
      worldRef.current = null;
    };
  }, [count, cycle]);

  useEffect(() => {
    if (worldRef.current) worldRef.current.calm = calm;
  }, [calm]);

  return <canvas ref={ref} className="ambient-canvas" aria-hidden="true" />;
}
