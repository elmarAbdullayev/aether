import { findCommands, type VoiceCommand } from "./commands";

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
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionClass = new () => Recognition;

export type VoiceState = "off" | "listening" | "blocked" | "unsupported" | "error";

export interface VoiceCallbacks {
  onCommand(command: VoiceCommand): void;
  onHeard(text: string): void;
  onState(state: VoiceState): void;
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
  private fired = new Map<number, Set<VoiceCommand>>();

  constructor(private readonly callbacks: VoiceCallbacks) {}

  start(): void {
    const Klass = recognitionClass();
    if (!Klass) {
      this.callbacks.onState("unsupported");
      return;
    }
    if (this.running) return;
    this.running = true;
    const rec = new Klass();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (text.trim()) this.callbacks.onHeard(text.trim());
        const done = this.fired.get(i) ?? new Set<VoiceCommand>();
        for (const command of findCommands(text)) {
          if (done.has(command)) continue;
          done.add(command);
          this.callbacks.onCommand(command);
        }
        this.fired.set(i, done);
      }
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.running = false;
        this.callbacks.onState("blocked");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        this.callbacks.onState("error");
      }
    };
    rec.onend = () => {
      // the browser stops after some silence; start again while we still want to listen
      this.fired.clear();
      if (!this.running) {
        this.callbacks.onState("off");
        return;
      }
      window.setTimeout(() => {
        if (!this.running || this.recognition !== rec) return;
        try {
          rec.start();
          this.callbacks.onState("listening");
        } catch {
          this.running = false;
          this.callbacks.onState("error");
        }
      }, 300);
    };
    this.recognition = rec;
    try {
      rec.start();
      this.callbacks.onState("listening");
    } catch {
      this.running = false;
      this.callbacks.onState("error");
    }
  }

  stop(): void {
    this.running = false;
    this.recognition?.abort();
    this.recognition = null;
  }
}
