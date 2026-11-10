import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./gestures";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface RawHand {
  /** "Left" or "Right" from the person's view. Used to keep each hand's state apart. */
  id: string;
  landmarks: Landmark[];
}

/** Camera + MediaPipe hand detection. Everything runs on this computer, no video is uploaded. */
export class HandTracker {
  private lastVideoTime = -1;
  private last: RawHand[] = [];

  private constructor(
    private readonly landmarker: HandLandmarker,
    readonly video: HTMLVideoElement,
    private readonly stream: MediaStream,
  ) {}

  static async start(video: HTMLVideoElement): Promise<HandTracker> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" },
      audio: false,
    });
    try {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
      const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO" as const,
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      let landmarker: HandLandmarker;
      try {
        landmarker = await HandLandmarker.createFromOptions(files, options("GPU"));
      } catch {
        landmarker = await HandLandmarker.createFromOptions(files, options("CPU"));
      }
      return new HandTracker(landmarker, video, stream);
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      throw error;
    }
  }

  get aspect(): number {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
  }

  /** Hands in the newest camera frame. Returns the previous result if no new frame came. */
  detect(now: number): RawHand[] {
    const video = this.video;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return this.last;
    this.lastVideoTime = video.currentTime;
    const result = this.landmarker.detectForVideo(video, now);
    const seen = new Set<string>();
    this.last = result.landmarks.map((landmarks, i) => {
      let id = result.handedness[i]?.[0]?.categoryName || `hand${i}`;
      if (seen.has(id)) id = `${id}${i}`;
      seen.add(id);
      return { id, landmarks };
    });
    return this.last;
  }

  stop(): void {
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.landmarker.close();
  }
}
