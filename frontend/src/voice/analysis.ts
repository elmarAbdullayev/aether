/**
 * Pure sound analysis for Voice World: pitch from the wave, loudness per frequency band.
 * No browser API in here, so it is unit tested with made-up waves.
 */

/** Loudness (root mean square) of a wave, 0..1 for normal microphone levels. */
export function rms(wave: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
  return Math.sqrt(sum / wave.length);
}

/**
 * Pitch of a voice or whistle in Hz, or null when it is too quiet or has no clear tone.
 * Normalized autocorrelation: how well the wave matches itself shifted by one period.
 */
export function detectPitch(wave: Float32Array, sampleRate: number, minHz = 70, maxHz = 1100): number | null {
  if (rms(wave) < 0.01) return null;
  const n = Math.min(wave.length, 2048);
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2));
  if (maxLag <= minLag + 2) return null;
  const corr = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let sum = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = wave[i];
      const b = wave[i + lag];
      sum += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    corr[lag] = e1 && e2 ? sum / Math.sqrt(e1 * e2) : 0;
    if (lag <= maxLag && corr[lag] > best) best = corr[lag];
  }
  if (best < 0.6) return null;
  // the first strong peak is the real period (later peaks are 2x, 3x the period: octave errors)
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const c = corr[lag];
    if (c >= best * 0.92 && c >= corr[lag - 1] && c >= corr[lag + 1]) {
      // parabola through the three points around the peak, for a smoother result
      const a = corr[lag - 1];
      const d = corr[lag + 1];
      const shift = (a - d) / (2 * (a - 2 * c + d) || 1);
      return sampleRate / (lag + Math.max(-0.5, Math.min(0.5, shift)));
    }
  }
  return null;
}

/**
 * Turns an FFT result (decibels per bin, as from AnalyserNode.getFloatFrequencyData) into
 * `count` bands from fMin to fMax, spaced like human hearing (logarithmic). Each band 0..1.
 */
export function logBands(
  decibels: Float32Array,
  sampleRate: number,
  count: number,
  fMin = 80,
  fMax = 5000,
  floorDb = -85,
  rangeDb = 55,
): Float32Array {
  const bands = new Float32Array(count);
  const binHz = sampleRate / 2 / decibels.length;
  for (let k = 0; k < count; k++) {
    const f0 = fMin * Math.pow(fMax / fMin, k / count);
    const f1 = fMin * Math.pow(fMax / fMin, (k + 1) / count);
    const from = Math.max(0, Math.floor(f0 / binHz));
    const to = Math.min(decibels.length - 1, Math.max(from, Math.ceil(f1 / binHz)));
    let peak = -Infinity;
    for (let b = from; b <= to; b++) if (decibels[b] > peak) peak = decibels[b];
    bands[k] = Math.min(1, Math.max(0, (peak - floorDb) / rangeDb));
  }
  return bands;
}

/** Simple name for a pitch, for the interface. */
export function pitchName(hz: number): "low" | "middle" | "high" {
  return hz < 160 ? "low" : hz < 350 ? "middle" : "high";
}
