import { Sound } from "../../audio/sound";
import type { Gesture } from "../../vision/gestures";
import { CameraHands, MouseHand, type HandInput } from "../../vision/handInput";
import { PersonSegmenter } from "../../vision/segmenter";
import { SwipeDetector } from "../../vision/swipe";
import { MIRROR_VOCABULARY, type VoiceCommand } from "../../voice/commands";
import { VoiceControl, type VoiceState } from "../../voice/voice";
import { HologramScene, STYLE_ORDER, type MirrorStyle } from "./scene";

export interface MirrorEvents {
  style(style: MirrorStyle): void;
  gestures(gestures: Gesture[]): void;
  /** false while nobody stands in front of the camera */
  person(visible: boolean): void;
  voiceState(state: VoiceState, detail?: string): void;
  talking(talking: boolean): void;
  heard(text: string): void;
  command(command: VoiceCommand): void;
}

/**
 * Runs Hologram Mirror: camera, person segmentation, hand gestures (wave = next style,
 * fist = dust, open hand = rebuild), voice and sound.
 */
export class MirrorSession {
  readonly scene: HologramScene;
  readonly sound = new Sound();
  private camera: CameraHands | null = null;
  private segmenter: PersonSegmenter | null = null;
  private video: HTMLVideoElement | null = null;
  private mouse: MouseHand;
  private voice: VoiceControl;
  private swipe = new SwipeDetector();
  private frameId = 0;
  private last = 0;
  private gestureKey = "";
  private personVisible = true;
  private personChangedAt = 0;
  private disposers: (() => void)[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly events: MirrorEvents,
  ) {
    this.scene = new HologramScene(canvas);
    this.voice = new VoiceControl(MIRROR_VOCABULARY, {
      onCommand: (c) => events.command(c),
      onHeard: (t) => events.heard(t),
      onState: (s, detail) => events.voiceState(s, detail),
      onSpeech: (t) => events.talking(t),
    });
    // with the mouse: hold the left button = dust, let go = rebuild
    this.mouse = new MouseHand(canvas, { left: "fist", right: "fist", onZoom: () => {}, onPress: () => this.sound.unlock() });
    if (import.meta.env.DEV) (window as unknown as { __aether?: unknown }).__aether = { scene: this.scene, session: this };
    const onResize = () => this.scene.resize();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.frameId = requestAnimationFrame(this.frame);
  }

  get style(): MirrorStyle {
    return this.scene.style;
  }

  /** Starts the camera and both models. Without segmentation the whole picture is shown. */
  async start(video: HTMLVideoElement): Promise<void> {
    if (this.camera) return;
    this.camera = await CameraHands.start(video);
    this.video = video;
    if (video.videoWidth && video.videoHeight) this.scene.setAspect(video.videoWidth / video.videoHeight);
    try {
      this.segmenter = await PersonSegmenter.create();
    } catch (e) {
      console.warn("[mirror] person segmentation could not start, showing the whole picture", e);
    }
  }

  startVoice(): void {
    void this.voice.start();
  }

  micLevel(): number {
    return this.voice.level();
  }

  setStyle(style: MirrorStyle): void {
    if (style === this.scene.style) return;
    this.scene.setStyle(style);
    this.sound.glitch();
    this.events.style(style);
  }

  stepStyle(direction: 1 | -1): void {
    const at = STYLE_ORDER.indexOf(this.scene.style);
    this.setStyle(STYLE_ORDER[(at + direction + STYLE_ORDER.length) % STYLE_ORDER.length]);
  }

  setCalm(calm: boolean): void {
    this.scene.calm = calm;
    this.sound.setCalm(calm);
  }

  setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
  }

  capture(silent = false): string {
    if (!silent) this.sound.shutter();
    return this.scene.capture();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.disposers.forEach((d) => d());
    this.mouse.stop();
    this.voice.stop();
    this.sound.dispose();
    this.camera?.stop();
    this.segmenter?.close();
    this.scene.dispose();
  }

  private frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const dt = Math.min(this.last ? (now - this.last) / 1000 : 1 / 60, 1 / 20);
    this.last = now;

    const hands: HandInput[] = this.camera ? this.camera.read(now, dt) : [];
    const mouse = this.mouse.read(now);
    if (mouse && mouse.gesture !== "none") hands.push(mouse);
    this.handleGestures(hands, now);

    if (this.video && this.segmenter) this.segmenter.update(this.video, now);
    const mask = this.segmenter
      ? { data: this.segmenter.mask, width: this.segmenter.width, height: this.segmenter.height }
      : null;
    this.scene.update(this.video, this.video ? mask : null, dt);
    this.scene.render();

    if (this.camera) {
      const visible = this.scene.coverage > 0.015 || this.scene.dissolved;
      if (visible !== this.personVisible && now - this.personChangedAt > 1200) {
        this.personVisible = visible;
        this.personChangedAt = now;
        this.events.person(visible);
      }
    }
  };

  private handleGestures(hands: HandInput[], now: number): void {
    const gestures = hands.map((h) => h.gesture);
    const key = gestures.join(",");
    if (key !== this.gestureKey) {
      this.gestureKey = key;
      this.events.gestures(gestures);
    }
    if (gestures.includes("fist")) {
      if (!this.scene.dissolved) {
        this.scene.dissolve();
        this.sound.dissolve();
      }
    } else if (gestures.includes("open") && this.scene.dissolved && this.scene.dustAge > 0.5) {
      this.scene.reform();
      this.sound.reform();
    }
    // a quick wave of a free hand changes the style
    const free = hands.find((h) => h.id !== "mouse" && h.gesture !== "fist");
    const swipe = this.swipe.push(now, free ? free.palm.x : null);
    if (swipe) this.stepStyle(swipe);
  }
}
