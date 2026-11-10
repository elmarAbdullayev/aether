import { findCommands, type VoiceCommand, type Vocabulary } from "./commands";
import { MicLevel } from "./micLevel";

/* The Web Speech API is not in TypeScript's DOM types yet, so the parts we use are typed here. */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechResult };
}
interface SpeechErrorEvent extends Event {
  readonly error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionClass = new () => Recognition;

export type VoiceState =
  | "off"
  | "starting"
  | "listening"
  /** the browser or Windows does not allow the microphone */
  | "blocked"
  /** no microphone found, or another app holds it */
  | "no-mic"
  /** the browser's speech service cannot be reached */
  | "network"
  | "unsupported"
  | "error";

export interface VoiceCallbacks {
  onCommand(command: VoiceCommand): void;
  onHeard(text: string): void;
  /** detail: the browser's error code, to show when something goes wrong */
  onState(state: VoiceState, detail?: string): void;
  /** true while the speech service hears someone talking */
  onSpeech?(talking: boolean): void;
}

function recognitionClass(): RecognitionClass | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return recognitionClass() !== null;
}

/**
 * Listens all the time and fires a command as soon as it is heard (also in unfinished
 * results, so it feels instant). Each command fires only once per spoken phrase.
 * Note: Edge and Chrome send the audio to their speech service to turn it into text.
 */
export class VoiceControl {
  private recognition: Recognition | null = null;
  private running = false;
  private state: VoiceState = "off";
  private networkErrors = 0;
  private fired = new Map<number, Set<VoiceCommand>>();
  private mic: MicLevel | null = null;
  private stopped = false;

  constructor(
    private readonly vocabulary: Vocabulary,
    private readonly callbacks: VoiceCallbacks,
  ) {}

  /** Microphone loudness 0..1 for the level meter (0 when the microphone is not open). */
  level(): number {
    return this.mic?.level() ?? 0;
  }

  /** Name of the microphone in use. */
  get micName(): string {
    return this.mic?.name ?? "";
  }

  /**
   * Opens the microphone first (for the level meter, and to get a clear error when it is
   * blocked or missing), then starts the speech recognition.
   */
  async start(): Promise<void> {
    const Klass = recognitionClass();
    if (!Klass) {
      this.setState("unsupported");
      return;
    }
    if (this.running || this.mic) return;
    this.stopped = false;
    this.setState("starting");
    try {
      this.mic = await MicLevel.start();
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      console.warn("[voice] microphone error:", e);
      if (name === "NotAllowedError" || name === "SecurityError") this.setState("blocked", name);
      else if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError")
        this.setState("no-mic", name);
      else this.setState("error", e instanceof Error ? e.message : String(e));
      return;
    }
    if (this.stopped) {
      this.mic.stop();
      this.mic = null;
      return;
    }
    this.running = true;
    const rec = new Klass();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => this.setState("listening");
    rec.onspeechstart = () => this.callbacks.onSpeech?.(true);
    rec.onspeechend = () => this.callbacks.onSpeech?.(false);
    rec.onresult = (event) => {
      this.networkErrors = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (text.trim()) this.callbacks.onHeard(text.trim());
        const done = this.fired.get(i) ?? new Set<VoiceCommand>();
        for (const command of findCommands(text, this.vocabulary)) {
          if (done.has(command)) continue;
          done.add(command);
          this.callbacks.onCommand(command);
        }
        this.fired.set(i, done);
      }
    };
    rec.onerror = (event) => {
      const code = event.error;
      console.warn("[voice] speech recognition error:", code);
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") this.fail("blocked", code);
      else if (code === "audio-capture") this.fail("no-mic", code);
      else if (code === "network") {
        this.networkErrors++;
        if (this.networkErrors >= 4) this.fail("network", code);
        else this.setState("network", code);
      } else this.setState("error", code);
    };
    rec.onend = () => {
      // the browser stops after some silence; start again while we still want to listen
      this.fired.clear();
      this.callbacks.onSpeech?.(false);
      if (!this.running) {
        if (this.state === "listening" || this.state === "starting") this.setState("off");
        return;
      }
      // restart almost at once: while it restarts nobody listens, and words get lost
      const wait = this.networkErrors ? 1500 * this.networkErrors : 40;
      window.setTimeout(() => {
        if (!this.running || this.recognition !== rec) return;
        try {
          rec.start();
        } catch (e) {
          this.fail("error", e instanceof Error ? e.message : String(e));
        }
      }, wait);
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch (e) {
      this.fail("error", e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    this.recognition?.abort();
    this.recognition = null;
    this.mic?.stop();
    this.mic = null;
  }

  /** A problem that will not go away by itself: stop listening and keep the message. */
  private fail(state: VoiceState, detail?: string): void {
    this.running = false;
    this.setState(state, detail);
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.callbacks.onState(state, detail);
  }
}
