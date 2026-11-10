/**
 * Measures how loud the microphone is, so the interface can show a level meter.
 * Runs only in the browser; no sound is sent anywhere.
 */
export class MicLevel {
  private data: Float32Array<ArrayBuffer>;
  private smooth = 0;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly analyser: AnalyserNode,
    private readonly stream: MediaStream,
  ) {
    this.data = new Float32Array(analyser.fftSize);
  }

  /** Throws the browser's DOMException (NotAllowedError, NotFoundError, NotReadableError) on problems. */
  static async start(): Promise<MicLevel> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    return new MicLevel(ctx, analyser, stream);
  }

  /** Name of the microphone in use, e.g. "Microphone (Realtek Audio)". */
  get name(): string {
    return this.stream.getAudioTracks()[0]?.label ?? "";
  }

  /** Loudness 0..1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) sum += v * v;
    const rms = Math.sqrt(sum / this.data.length);
    const target = Math.min(1, rms * 9);
    this.smooth += (target - this.smooth) * (target > this.smooth ? 0.6 : 0.15);
    return this.smooth;
  }

  stop(): void {
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}
