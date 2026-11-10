import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

/** MediaPipe selfie segmenter, landscape version (144 x 256), made for webcams. */
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";

/**
 * Finds which pixels of the camera picture belong to the person. Runs in the browser.
 * The selfie model has two categories: 0 = background, 1 = person.
 */
export class PersonSegmenter {
  /** Person probability 0..1 per mask pixel, row by row. Same orientation as the camera (not mirrored). */
  mask = new Float32Array(0);
  width = 0;
  height = 0;
  private lastVideoTime = -1;
  /** The model works at 256 x 144 anyway; a small input also gives a small, fast mask. */
  private small = document.createElement("canvas").getContext("2d")!;

  private constructor(private readonly segmenter: ImageSegmenter) {
    this.small.canvas.width = 256;
    this.small.canvas.height = 144;
  }

  static async create(): Promise<PersonSegmenter> {
    const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    try {
      return new PersonSegmenter(await ImageSegmenter.createFromOptions(files, options("GPU")));
    } catch {
      return new PersonSegmenter(await ImageSegmenter.createFromOptions(files, options("CPU")));
    }
  }

  /** Reads the newest camera frame. Returns false when there was no new frame. */
  update(video: HTMLVideoElement, now: number): boolean {
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = video.currentTime;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const h = Math.round(256 / aspect);
    if (this.small.canvas.height !== h) this.small.canvas.height = h;
    this.small.drawImage(video, 0, 0, 256, h);
    this.segmenter.segmentForVideo(this.small.canvas, now, (result) => {
      const masks = result.confidenceMasks;
      if (!masks?.length) return;
      // the selfie model gives one mask (person) or two (background, person); tested: one mask = person
      const person = masks.length > 1 ? masks[1] : masks[0];
      // the mask only lives during this callback, so copy it
      const data = person.getAsFloat32Array();
      if (this.mask.length !== data.length) this.mask = new Float32Array(data.length);
      this.mask.set(data);
      this.width = person.width;
      this.height = person.height;
    });
    return true;
  }

  close(): void {
    this.segmenter.close();
  }
}
