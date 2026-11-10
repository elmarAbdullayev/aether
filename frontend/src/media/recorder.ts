/**
 * Records a short clip of a world: the 3D canvas plus the world's own sounds (never the
 * microphone). MP4 when the browser can (better for LinkedIn and phones), otherwise WebM.
 */

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

function pickFormat(withAudio: boolean): { mimeType: string; type: "video/mp4" | "video/webm" } | null {
  const options: [string, "video/mp4" | "video/webm"][] = withAudio
    ? [
        ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"],
        ["video/mp4", "video/mp4"],
        ["video/webm;codecs=vp9,opus", "video/webm"],
        ["video/webm;codecs=vp8,opus", "video/webm"],
        ["video/webm", "video/webm"],
      ]
    : [
        ["video/mp4;codecs=avc1.42E01E", "video/mp4"],
        ["video/mp4", "video/mp4"],
        ["video/webm;codecs=vp9", "video/webm"],
        ["video/webm;codecs=vp8", "video/webm"],
        ["video/webm", "video/webm"],
      ];
  for (const [mimeType, type] of options) if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, type };
  return null;
}

/** Records `seconds` of the canvas. onTick gets the whole seconds that are left. */
export function recordClip(
  canvas: HTMLCanvasElement,
  seconds: number,
  audio: MediaStream | null,
  onTick: (secondsLeft: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(30);
    audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const format = pickFormat(stream.getAudioTracks().length > 0);
    if (!format) {
      reject(new Error("This browser cannot record video."));
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error("Recording failed."));
    recorder.onstop = () => {
      stream.getVideoTracks().forEach((t) => t.stop());
      // plain type without codecs, so the data URL stays simple
      resolve(new Blob(chunks, { type: format.type }));
    };
    recorder.start(250);
    let left = seconds;
    onTick(left);
    const timer = window.setInterval(() => {
      left--;
      onTick(left);
      if (left <= 0) {
        window.clearInterval(timer);
        recorder.stop();
      }
    }, 1000);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
