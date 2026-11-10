import { Sound } from "../../audio/sound";
import { BRUSH_ORDER, type BrushColor, type SculptureJSON, BRUSHES } from "../../engine/sculpture";
import type { Gesture } from "../../vision/gestures";
import { CameraHands, MouseHand, type HandInput } from "../../vision/handInput";
import { DRAW_VOCABULARY, type VoiceCommand } from "../../voice/commands";
import { VoiceControl, type VoiceState } from "../../voice/voice";
import { DrawController } from "./controller";
import { DrawScene } from "./scene";

export interface DrawSessionEvents {
  gestures(gestures: Gesture[]): void;
  handsVisible(visible: boolean): void;
  brush(brush: BrushColor): void;
  strokes(count: number): void;
  voiceState(state: VoiceState, detail?: string): void;
  talking(talking: boolean): void;
  heard(text: string): void;
  command(command: VoiceCommand): void;
}

/** Runs Air Drawing: frame loop, camera, mouse, voice and sound. React shows the interface. */
export class DrawSession {
  readonly scene: DrawScene;
  readonly sound = new Sound();
  private controller: DrawController;
  private camera: CameraHands | null = null;
  private mouse: MouseHand;
  private voice: VoiceControl;
  private frameId = 0;
  private last = 0;
  private gestureKey = "";
  private visible = false;
  private preview: CanvasRenderingContext2D | null = null;
  private disposers: (() => void)[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly events: DrawSessionEvents,
  ) {
    this.scene = new DrawScene(canvas);
    this.controller = new DrawController(this.scene, this.sound, { strokes: (n) => events.strokes(n) });
    this.voice = new VoiceControl(DRAW_VOCABULARY, {
      onCommand: (c) => events.command(c),
      onHeard: (t) => events.heard(t),
      onState: (s, detail) => events.voiceState(s, detail),
      onSpeech: (t) => events.talking(t),
    });
    this.mouse = new MouseHand(canvas, {
      left: "pinch",
      right: "fist",
      onZoom: (f) => {
        this.scene.targetScale = Math.min(2.4, Math.max(0.4, this.scene.targetScale * f));
      },
      onPress: () => this.sound.unlock(),
    });
    // dev only: lets tests drive the world from the console
    if (import.meta.env.DEV) (window as unknown as { __aether?: unknown }).__aether = { scene: this.scene, session: this };
    const onResize = () => this.scene.resize();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.frameId = requestAnimationFrame(this.frame);
  }

  get brush(): BrushColor {
    return this.controller.brush;
  }

  async startCamera(video: HTMLVideoElement): Promise<void> {
    if (this.camera) return;
    this.camera = await CameraHands.start(video);
  }

  startVoice(): void {
    void this.voice.start();
  }

  /** Microphone loudness 0..1 for the level meter. */
  micLevel(): number {
    return this.voice.level();
  }

  setBrush(brush: BrushColor): void {
    if (brush === this.controller.brush) return;
    this.controller.setBrush(brush);
    this.sound.colorChime(BRUSH_ORDER.indexOf(brush));
    this.events.brush(brush);
  }

  undo(): boolean {
    return this.controller.undo();
  }

  clear(): void {
    this.controller.clear();
  }

  setCalm(calm: boolean): void {
    this.scene.calm = calm;
    this.sound.setCalm(calm);
  }

  setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
  }

  setPreview(canvas: HTMLCanvasElement | null): void {
    this.preview = canvas?.getContext("2d") ?? null;
  }

  /** Picture of the screen plus the drawing as 3D data (null when nothing is drawn). */
  capture(): { image: string; sculpture: SculptureJSON | null } {
    this.sound.shutter();
    const sculpture = this.scene.data.toJSON();
    return { image: this.scene.capture(), sculpture: sculpture.strokes.length ? sculpture : null };
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.disposers.forEach((d) => d());
    this.mouse.stop();
    this.voice.stop();
    this.sound.dispose();
    this.camera?.stop();
    this.scene.dispose();
  }

  private frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const dt = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;

    const hands: HandInput[] = [];
    if (this.camera) {
      hands.push(...this.camera.read(now, dt));
      this.setVisible(this.camera.visible(now));
    }
    const mouse = this.mouse.read(now);
    if (mouse) hands.push(mouse);

    this.controller.update(hands, Math.min(dt, 0.1));
    const gestures = this.controller.gestures();
    const key = gestures.join(",");
    if (key !== this.gestureKey) {
      this.gestureKey = key;
      this.events.gestures(gestures);
    }

    this.scene.step(Math.min(dt, 1 / 20));
    this.scene.render();
    if (this.preview && this.camera) this.camera.drawPreview(this.preview, BRUSHES[this.controller.brush].css);
  };

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.events.handsVisible(visible);
  }
}
