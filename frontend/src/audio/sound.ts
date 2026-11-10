import type { ElementName } from "../engine/elements";

/**
 * All sounds are made live with the Web Audio API: no sound files.
 * The AudioContext starts on the first click (browsers require that).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private hole: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private pad: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private voice: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private muted = false;
  private calm = false;

  /** Call from a click or key press. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 6;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(compressor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet);
    wet.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startPad();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setCalm(calm: boolean): void {
    this.calm = calm;
    if (this.ctx && this.pad) this.pad.gain.gain.setTargetAtTime(calm ? 0 : 0.05, this.ctx.currentTime, 0.5);
  }

  /** Big noise burst with a deep boom. power 0..1 */
  explosion(power: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const p = Math.max(0.2, Math.min(1, power));

    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(5000, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + 1.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7 * p, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    src.connect(filter).connect(gain);
    this.out(gain, 0.6);
    src.start(now);
    src.stop(now + 2);

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(110, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 1.1);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(0.9 * p, now + 0.015);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    boom.connect(boomGain);
    this.out(boomGain, 0.2);
    boom.start(now);
    boom.stop(now + 1.4);
  }

  /** Deep hum that rises while the fist is held. charge 0..1, or null to stop. */
  blackHole(charge: number | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (charge === null) {
      if (this.hole) {
        const hole = this.hole;
        hole.gain.gain.setTargetAtTime(0, now, 0.12);
        hole.osc.forEach((o) => o.stop(now + 0.8));
        this.hole = null;
      }
      return;
    }
    if (!this.hole) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 200;
      filter.Q.value = 6;
      const osc = [38, 38.7, 57].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 2 ? "sine" : "sawtooth";
        o.frequency.value = f;
        o.connect(filter);
        o.start(now);
        return o;
      });
      filter.connect(gain);
      this.out(gain, 0.3);
      this.hole = { osc, gain, filter };
    }
    const c = Math.max(0, Math.min(1, charge));
    this.hole.gain.gain.setTargetAtTime(0.12 + 0.3 * c, now, 0.08);
    this.hole.filter.frequency.setTargetAtTime(160 + 900 * c, now, 0.1);
    this.hole.osc.forEach((o, i) => o.frequency.setTargetAtTime([38, 38.7, 57][i] * (1 + c * 0.6), now, 0.1));
  }

  /** Bright sparkle when a star is grabbed. */
  grab(): void {
    this.bell([1318, 1976, 2637], 0.12, 0.6);
  }

  /** Whoosh when a star is thrown. speed in world units per second. */
  whoosh(speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(400 + Math.min(speed, 40) * 120, now + 0.35);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    src.connect(filter).connect(gain);
    this.out(gain, 0.5);
    src.start(now);
    src.stop(now + 0.7);
  }

  /** Small pop when a thrown star burns out. */
  pop(): void {
    this.bell([880, 1320], 0.1, 0.35);
  }

  /** Chord for each element. */
  element(name: ElementName): void {
    const chords: Record<ElementName, number[]> = {
      galaxy: [261.6, 392, 493.9, 587.3],
      fire: [196, 246.9, 293.7, 392],
      ice: [659.3, 987.8, 1318.5, 1760],
      rainbow: [523.3, 659.3, 784, 1046.5],
    };
    this.bell(chords[name], 0.14, 1.8, name === "rainbow" ? 0.07 : 0.02);
    if (this.pad && this.ctx) {
      const base = chords[name][0] / 4;
      this.pad.osc.forEach((o, i) => o.frequency.setTargetAtTime(base * [1, 1.5, 2.002][i], this.ctx!.currentTime, 0.8));
    }
  }

  /**
   * Theremin-like tone while drawing: level 0..1 is the hand height (higher hand, higher note).
   * null stops it.
   */
  theremin(level: number | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (level === null) {
      if (this.voice) {
        this.voice.gain.gain.setTargetAtTime(0, now, 0.08);
        this.voice.osc.forEach((o) => o.stop(now + 0.6));
        this.voice = null;
      }
      return;
    }
    if (!this.voice) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2400;
      const main = ctx.createOscillator();
      main.type = "sine";
      const low = ctx.createOscillator();
      low.type = "triangle";
      const lowGain = ctx.createGain();
      lowGain.gain.value = 0.25;
      // vibrato: a slow wobble of the pitch, like a real theremin
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.value = 5;
      lfo.connect(depth);
      depth.connect(main.frequency);
      main.connect(filter);
      low.connect(lowGain).connect(filter);
      filter.connect(gain);
      this.out(gain, 0.7);
      [main, low, lfo].forEach((o) => o.start(now));
      gain.gain.setTargetAtTime(0.1, now, 0.05);
      this.voice = { osc: [main, low, lfo], gain };
    }
    const freq = 150 * Math.pow(2, Math.min(1, Math.max(0, level)) * 2.5);
    this.voice.osc[0].frequency.setTargetAtTime(freq, now, 0.04);
    this.voice.osc[1].frequency.setTargetAtTime(freq / 2, now, 0.04);
  }

  /** Short rising notes when the brush color changes. */
  colorChime(index: number): void {
    const scale = [523.3, 587.3, 659.3, 784, 880, 1046.5];
    const base = index % 3;
    this.bell([scale[base], scale[base + 2], scale[base + 3]], 0.12, 0.9, 0.05);
  }

  /** Camera shutter for "save". */
  shutter(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    src.connect(filter).connect(gain);
    this.out(gain, 0.2);
    src.start(now);
    src.stop(now + 0.15);
  }

  dispose(): void {
    this.theremin(null);
    void this.ctx?.close();
    this.ctx = null;
  }

  /* ------------------------------------------------------------------- */

  private bell(freqs: number[], volume: number, length: number, spread = 0.02): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    freqs.forEach((f, i) => {
      const start = now + i * spread;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain);
      this.out(gain, 0.8);
      osc.start(start);
      osc.stop(start + length + 0.1);
    });
  }

  private startPad(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const osc = [65.4, 98.1, 130.9].map((f) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain);
    this.out(gain, 0.9);
    gain.gain.setTargetAtTime(this.calm ? 0 : 0.05, ctx.currentTime, 2);
    this.pad = { osc, gain };
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    return src;
  }

  /** Connect a sound to the speakers, with some of it going through the reverb. */
  private out(node: AudioNode, wet: number): void {
    if (!this.ctx || !this.master || !this.reverb) return;
    node.connect(this.master);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      node.connect(send);
      send.connect(this.reverb);
    }
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    return buffer;
  }
}
