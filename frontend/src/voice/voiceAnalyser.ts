import { detectPitch, logBands, rms } from "./analysis";

export interface VoiceFrame {
  /** loudness 0..1 */
  level: number;
  /** pitch in Hz, or null when there is no clear tone */
  pitch: number | null;
  /** loudness per frequency band 0..1, low to high */
  bands: Float32Array;
}

export const BAND_COUNT = 48;

/** Reads the microphone in the browser and turns it into level, pitch and bands. Nothing is sent anywhere. */
export class VoiceAnalyser {
  private wave: Float32Array<ArrayBuffer>;
  private spectrum: Float32Array<ArrayBuffer>;
  private frame: VoiceFrame = { level: 0, pitch: null, bands: new Float32Array(BAND_COUNT) };

  private constructor(
    private readonly ctx: AudioContext,
    private readonly analyser: AnalyserNode,
    private readonly stream: MediaStream,
  ) {
    this.wave = new Float32Array(analyser.fftSize);
    this.spectrum = new Float32Array(analyser.frequencyBinCount);
  }

  /** Throws the browser's DOMException when the microphone is blocked or missing. */
  static async start(): Promise<VoiceAnalyser> {
    const stream = await navigator.mediaDevices.getUserMedia({
      // no automatic volume: loud must stay loud, quiet must stay quiet
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      video: false,
    });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    ctx.createMediaStreamSource(stream).connect(analyser);
    return new VoiceAnalyser(ctx, analyser, stream);
  }

  read(): VoiceFrame {
    this.analyser.getFloatTimeDomainData(this.wave);
    this.analyser.getFloatFrequencyData(this.spectrum);
    const level = Math.min(1, rms(this.wave) * 7);
    this.frame.level += (level - this.frame.level) * (level > this.frame.level ? 0.5 : 0.12);
    this.frame.pitch = detectPitch(this.wave, this.ctx.sampleRate);
    this.frame.bands = logBands(this.spectrum, this.ctx.sampleRate, BAND_COUNT);
    return this.frame;
  }

  stop(): void {
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}
