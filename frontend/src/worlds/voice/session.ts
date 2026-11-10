import { Sound } from "../../audio/sound";
import { VOICE_VOCABULARY, type VoiceCommand } from "../../voice/commands";
import { VoiceControl, type VoiceState } from "../../voice/voice";
import { VoiceAnalyser, type VoiceFrame } from "../../voice/voiceAnalyser";
import { VoiceScene, type Weather } from "./scene";
import { phrasePieces } from "./words";

export interface VoiceWorldEvents {
  /** true after a few seconds without a sound */
  silent(silent: boolean): void;
  voiceState(state: VoiceState, detail?: string): void;
  talking(talking: boolean): void;
  heard(text: string): void;
  command(command: VoiceCommand): void;
}

/** Runs Voice World: microphone analysis, the flying landscape, speech words and magic words. */
export class VoiceWorldSession {
  readonly scene: VoiceScene;
  /** No background music here: the microphone would hear it and draw mountains from it. */
  readonly sound = new Sound({ pad: false });
  private analyser: VoiceAnalyser | null = null;
  private voice: VoiceControl;
  private frameData: VoiceFrame | null = null;
  private frameId = 0;
  private last = 0;
  private quietSince = 0;
  private silent = false;
  private disposers: (() => void)[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly events: VoiceWorldEvents,
  ) {
    this.scene = new VoiceScene(canvas);
    this.scene.onThunder = () => this.sound.thunder();
    this.voice = new VoiceControl(VOICE_VOCABULARY, {
      onCommand: (c) => events.command(c),
      onHeard: (t) => events.heard(t),
      onFinal: (t) => phrasePieces(t).forEach((piece, i) => window.setTimeout(() => this.scene.addWord(piece), i * 700)),
      onState: (s, detail) => events.voiceState(s, detail),
      onSpeech: (t) => events.talking(t),
    });
    const look = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.scene.setLook((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    canvas.addEventListener("pointermove", look);
    this.disposers.push(() => canvas.removeEventListener("pointermove", look));
    if (import.meta.env.DEV) (window as unknown as { __aether?: unknown }).__aether = { scene: this.scene, session: this };
    const onResize = () => this.scene.resize();
    window.addEventListener("resize", onResize);
    this.disposers.push(() => window.removeEventListener("resize", onResize));
    this.frameId = requestAnimationFrame(this.frame);
  }

  /** Opens the microphone for the landscape, then starts the speech recognition. */
  async start(): Promise<void> {
    if (this.analyser) return;
    this.analyser = await VoiceAnalyser.start();
    void this.voice.start();
  }

  /** Last microphone reading, for the meters. */
  get reading(): VoiceFrame | null {
    return this.frameData;
  }

  micLevel(): number {
    return this.frameData?.level ?? 0;
  }

  setWeather(kind: Weather): void {
    this.scene.setWeather(kind);
    if (kind !== "storm") this.sound.chime(kind);
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
    this.voice.stop();
    this.analyser?.stop();
    this.sound.dispose();
    this.scene.dispose();
  }

  private frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const dt = Math.min(this.last ? (now - this.last) / 1000 : 1 / 60, 1 / 20);
    this.last = now;
    this.frameData = this.analyser ? this.analyser.read() : null;
    this.scene.feed(this.frameData);
    this.scene.step(dt);
    this.scene.render();

    if (this.analyser) {
      const loud = (this.frameData?.level ?? 0) > 0.06;
      if (loud) this.quietSince = now;
      const silent = now - this.quietSince > 3000;
      if (silent !== this.silent) {
        this.silent = silent;
        this.events.silent(silent);
      }
    }
  };
}
