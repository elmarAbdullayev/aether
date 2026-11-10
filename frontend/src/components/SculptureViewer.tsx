import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getSculpture, type GalleryImage } from "../api/gallery";
import { SculptureData, SculptureMesh } from "../engine/sculpture";
import { Stage } from "../engine/stage";
import { Close } from "./icons";

/** Opens a saved Air Drawing sculpture in 3D: drag to turn it, wheel to zoom. */
export function SculptureViewer({ image, onClose }: { image: GalleryImage; onClose(): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let closed = false;
    let cleanup = () => {};
    getSculpture(image.id)
      .then((json) => {
        if (closed) return;
        const canvas = canvasRef.current!;
        const stage = new Stage(canvas);
        const mesh = new SculptureMesh(SculptureData.fromJSON(json), stage.pointMaterial());
        const sphere = mesh.bounds();
        mesh.object.position.copy(sphere.center).multiplyScalar(-1);
        const holder = new THREE.Group();
        holder.add(mesh.object);
        holder.scale.setScalar(3.6 / Math.max(sphere.radius, 0.5));
        stage.scene.add(holder);

        const controls = new OrbitControls(stage.camera, canvas);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.4;
        controls.minDistance = 4;
        controls.maxDistance = 24;

        let frame = 0;
        const loop = () => {
          frame = requestAnimationFrame(loop);
          controls.update();
          stage.render();
        };
        loop();
        const onResize = () => stage.resize();
        window.addEventListener("resize", onResize);
        setStatus("ready");
        cleanup = () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("resize", onResize);
          controls.dispose();
          stage.dispose();
        };
      })
      .catch(() => {
        if (!closed) setStatus("error");
      });
    return () => {
      closed = true;
      cleanup();
    };
  }, [image.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="3D sculpture">
      <canvas ref={canvasRef} className="viewer-canvas" />
      <div className="viewer-bar">
        <span>{status === "ready" ? "Drag to turn · wheel to zoom" : status === "loading" ? "Loading…" : "Could not load the sculpture."}</span>
        <button type="button" className="icon-btn" onClick={onClose} autoFocus>
          <Close />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </div>
  );
}
