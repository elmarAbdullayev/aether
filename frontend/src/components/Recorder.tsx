import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { saveImage, type WorldId } from "../api/gallery";
import { blobToDataUrl, recordClip, recordingSupported } from "../media/recorder";

export const CLIP_SECONDS = 5;

interface RecorderOptions {
  world: WorldId;
  canvas(): HTMLCanvasElement | null;
  /** the world's sounds, or null */
  audio(): MediaStream | null;
  /** a picture of the current frame, used as the preview in the gallery */
  poster(): string | null;
  toast(text: ReactNode, tone?: "ok" | "error"): void;
}

/** Records a 5 second clip of a world and saves it to the gallery. */
export function useClipRecorder(options: RecorderOptions): { secondsLeft: number | null; record(): void } {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const busy = useRef(false);
  const opts = useRef(options);
  opts.current = options;

  const record = useCallback(async () => {
    const o = opts.current;
    const canvas = o.canvas();
    if (busy.current || !canvas) return;
    if (!recordingSupported()) {
      o.toast("This browser cannot record video. Use Edge or Chrome.", "error");
      return;
    }
    busy.current = true;
    try {
      const blob = await recordClip(canvas, CLIP_SECONDS, o.audio(), setSecondsLeft);
      setSecondsLeft(null);
      const poster = o.poster();
      if (!poster) throw new Error("no preview picture");
      o.toast("Saving video…");
      await saveImage(o.world, poster, { video: await blobToDataUrl(blob) });
      o.toast(
        <>
          Video saved. <Link to="/gallery">Open the gallery</Link>
        </>,
      );
    } catch (e) {
      o.toast(`Could not save the video: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setSecondsLeft(null);
      busy.current = false;
    }
  }, []);

  return { secondsLeft, record: () => void record() };
}

export function RecIndicator({ secondsLeft }: { secondsLeft: number | null }) {
  if (secondsLeft === null) return null;
  return (
    <div className="rec" role="status">
      <span className="rec-dot" aria-hidden="true" />
      REC {Math.max(0, secondsLeft)}
    </div>
  );
}
