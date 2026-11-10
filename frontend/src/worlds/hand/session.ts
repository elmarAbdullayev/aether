import { Sound } from "../../audio/sound";
import type { ElementName } from "../../engine/elements";
import { ParticleWorld } from "../../engine/world";
import type { Gesture } from "../../vision/gestures";
import { CameraHands, MouseHand, type HandInput } from "../../vision/handInput";
import { HAND_VOCABULARY, type VoiceCommand } from "../../voice/commands";
import { VoiceControl, type VoiceState } from "../../voice/voice";
import { MagicController } from "./controller";

export interface SessionEvents {
  gestures(gestures: Gesture[]): void;
  handsVisible(visible: boolean): void;
  element(name: ElementName): void;
  voiceState(state: VoiceState, detail?: string): void;
  talking(talking: boolean): void;
  heard(text: string): void;
  command(command: VoiceCommand): void;
}

/**
 * Runs Hand Magic: the frame loop, camera, mouse, voice and sound.
 * React only shows the interface around it.
 */
export class HandSession {
  readonly world: ParticleWorld;
  readonly sound = new Sound();
  private controller: MagicController;
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
    private readonly events: SessionEvents,
  ) {
    this.world = new ParticleWorld(canvas);
    this.controller = new MagicController(this.world, this.sound);
    this.voice = new VoiceControl(HAND_VOCABULARY, {
      onCommand: (c) => events.command(c),
      onHeard: (t) => events.heard(t),
      onState: (s, detail) => events.voiceState(s, detail),
      onSpeech: (t) => events.talking(t),
    });
    this.mouse = new MouseHand(canvas, {
      left: "fist",
      right: "pinch",
      onZoom: (f) => {
        this.world.targetScale = Math.min(2.6, Math.max(0.35, this.world.targetScale * f));
      },
      onPress: () => this.sound.unlock(),
    });
    // dev only: lets tests drive the world from the console
    if (import.meta.env.DEV) (window as unknown as { __aether?: unknown }).__aether = { world: this.world, session: this };
    const onResize = () => this.world.resize();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.frameId = requestAnimationFrame(this.frame);
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

  setElement(name: ElementName): void {
    if (name === this.world.elementName) return;
    this.world.setElement(name);
    this.sound.element(name);
    this.events.element(name);
  }

  setCalm(calm: boolean): void {
    this.world.calm = calm;
    this.sound.setCalm(calm);
  }

  setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
  }

  setPreview(canvas: HTMLCanvasElement | null): void {
    this.preview = canvas?.getContext("2d") ?? null;
  }

  capture(): string {
    this.sound.shutter();
    return this.world.capture();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.disposers.forEach((d) => d());
    this.mouse.stop();
    this.voice.stop();
    this.sound.blackHole(null);
    this.sound.dispose();
    this.camera?.stop();
    this.world.dispose();
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

    this.controller.update(hands, dt);
    const gestures = this.controller.gestures();
    const key = gestures.join(",");
    if (key !== this.gestureKey) {
      this.gestureKey = key;
      this.events.gestures(gestures);
    }

    this.world.step(dt);
    this.world.render();
    if (this.preview && this.camera) this.camera.drawPreview(this.preview, this.world.accentColor);
  };

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.events.handsVisible(visible);
  }
}
