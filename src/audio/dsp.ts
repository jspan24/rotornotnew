/**
 * Pure-TypeScript DSP pipeline for knock recordings.
 *
 * Grocery-store noise removal is a two-stage process:
 *   1. Spectral subtraction — the quietest frames of the recording are used to
 *      estimate the steady background-noise spectrum (HVAC hum, chatter,
 *      music), which is subtracted from every frame.
 *   2. Transient gating — knocks are short impulsive events. We detect them
 *      on the energy envelope and strongly attenuate everything outside the
 *      knock windows, so playback is near-silence punctuated by clean knocks.
 *
 * Feature extraction then measures the pitch/hollowness character of each
 * knock (dominant resonance frequency, band-energy balance, spectral
 * flatness, resonance Q, decay time), which is what the model learns from.
 */

export interface KnockWindow {
  start: number; // sample index
  end: number; // sample index (exclusive)
}

export interface CleanResult {
  cleaned: Float32Array;
  knocks: KnockWindow[];
}

/** Number of acoustic features extracted per knock. */
export const FEATURE_COUNT = 8;

export const FEATURE_NAMES = [
  'dominantFreqHz',
  'spectralCentroidHz',
  'spectralRolloffHz',
  'lowBandRatio',
  'midBandRatio',
  'spectralFlatness',
  'resonanceQ',
  'decayTimeMs',
] as const;

// ---------------------------------------------------------------------------
// FFT (iterative radix-2, in-place)
// ---------------------------------------------------------------------------

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * curR - im[b] * curI;
        const ti = re[b] * curI + im[b] * curR;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nr;
      }
    }
  }
}

export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

// ---------------------------------------------------------------------------
// Spectral subtraction
// ---------------------------------------------------------------------------

const FRAME = 512;
const HOP = 128; // 75% overlap for smooth weighted overlap-add

/**
 * Remove steady background noise via spectral subtraction. The noise spectrum
 * is estimated from the quietest 25% of frames of the recording itself, so it
 * adapts to whatever store the user is standing in.
 */
export function spectralSubtract(input: Float32Array): Float32Array {
  const n = input.length;
  if (n < FRAME * 2) return input.slice();

  const window = hannWindow(FRAME);
  const frameCount = Math.floor((n - FRAME) / HOP) + 1;
  const bins = FRAME / 2 + 1;

  // Pass 1: magnitudes + frame energies for the noise estimate.
  const mags = new Array<Float64Array>(frameCount);
  const phases = new Array<Float64Array>(frameCount);
  const energies = new Float64Array(frameCount);

  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);

  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = input[off + i] * window[i];
      re[i] = s;
      im[i] = 0;
      energy += s * s;
    }
    energies[f] = energy;
    fft(re, im);
    const mag = new Float64Array(bins);
    const ph = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      ph[k] = Math.atan2(im[k], re[k]);
    }
    mags[f] = mag;
    phases[f] = ph;
  }

  // Noise spectrum = average magnitude of the quietest 25% of frames.
  const order = Array.from({ length: frameCount }, (_, i) => i).sort(
    (a, b) => energies[a] - energies[b]
  );
  const noiseFrames = Math.max(1, Math.floor(frameCount * 0.25));
  const noiseMag = new Float64Array(bins);
  for (let i = 0; i < noiseFrames; i++) {
    const mag = mags[order[i]];
    for (let k = 0; k < bins; k++) noiseMag[k] += mag[k];
  }
  for (let k = 0; k < bins; k++) noiseMag[k] /= noiseFrames;

  // Pass 2: subtract (with over-subtraction + spectral floor), resynthesize.
  const ALPHA = 1.8; // over-subtraction factor
  const FLOOR = 0.05; // keep 5% of original magnitude to avoid musical noise

  const out = new Float64Array(n);
  const norm = new Float64Array(n);

  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP;
    const mag = mags[f];
    const ph = phases[f];
    for (let k = 0; k < bins; k++) {
      const cleanedMag = Math.max(mag[k] - ALPHA * noiseMag[k], FLOOR * mag[k]);
      re[k] = cleanedMag * Math.cos(ph[k]);
      im[k] = cleanedMag * Math.sin(ph[k]);
      if (k > 0 && k < FRAME / 2) {
        re[FRAME - k] = re[k];
        im[FRAME - k] = -im[k];
      }
    }
    im[0] = 0;
    im[FRAME / 2] = 0;
    ifft(re, im);
    for (let i = 0; i < FRAME; i++) {
      out[off + i] += re[i] * window[i];
      norm[off + i] += window[i] * window[i];
    }
  }

  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = norm[i] > 1e-9 ? out[i] / norm[i] : 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Knock detection + gating
// ---------------------------------------------------------------------------

/** RMS envelope in short blocks. */
function envelope(samples: Float32Array, blockSize: number): Float64Array {
  const blocks = Math.ceil(samples.length / blockSize);
  const env = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    const start = b * blockSize;
    const end = Math.min(start + blockSize, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    env[b] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return env;
}

function median(values: Float64Array): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Detect impulsive knock events on the energy envelope.
 * A knock onset is a local energy peak well above the recording's noise floor.
 */
export function detectKnocks(samples: Float32Array, sampleRate: number): KnockWindow[] {
  const blockSize = Math.round(sampleRate * 0.005); // 5 ms blocks
  const env = envelope(samples, blockSize);
  if (env.length === 0) return [];

  const floor = median(env);
  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  if (peak < 1e-4) return [];

  // A block qualifies if it towers over the noise floor and is a decent
  // fraction of the loudest event in the recording.
  const threshold = Math.max(floor * 5, peak * 0.2, 1e-4);

  const minGapBlocks = Math.round(0.15 / 0.005); // 150 ms between knocks
  const preRoll = Math.round(sampleRate * 0.01); // keep 10 ms before onset
  const windowLen = Math.round(sampleRate * 0.3); // 300 ms of ring-down

  const knocks: KnockWindow[] = [];
  let lastOnsetBlock = -minGapBlocks;

  for (let b = 1; b < env.length - 1; b++) {
    if (env[b] < threshold) continue;
    if (env[b] < env[b - 1] || env[b] < env[b + 1]) continue; // local max only
    if (b - lastOnsetBlock < minGapBlocks) continue;
    lastOnsetBlock = b;
    const onset = b * blockSize;
    knocks.push({
      start: Math.max(0, onset - preRoll),
      end: Math.min(samples.length, onset + windowLen),
    });
  }

  // Merge overlapping windows.
  const merged: KnockWindow[] = [];
  for (const k of knocks) {
    const last = merged[merged.length - 1];
    if (last && k.start <= last.end) last.end = Math.max(last.end, k.end);
    else merged.push({ ...k });
  }
  return merged;
}

/**
 * Strongly attenuate everything outside knock windows (with short fades),
 * leaving crisp knocks over near-silence.
 */
export function gateOutsideKnocks(
  samples: Float32Array,
  sampleRate: number,
  knocks: KnockWindow[]
): Float32Array {
  const out = new Float32Array(samples.length);
  const ATTEN = 0.02; // about -34 dB outside knocks
  const fade = Math.round(sampleRate * 0.01); // 10 ms fades

  const gain = new Float32Array(samples.length).fill(ATTEN);
  for (const k of knocks) {
    for (let i = k.start; i < k.end; i++) gain[i] = 1;
    for (let i = 1; i <= fade; i++) {
      const g = ATTEN + (1 - ATTEN) * (1 - i / fade);
      const before = k.start - i;
      const after = k.end + i - 1;
      if (before >= 0) gain[before] = Math.max(gain[before], g);
      if (after < samples.length) gain[after] = Math.max(gain[after], g);
    }
  }
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain[i];
  return out;
}

/**
 * Full cleanup pipeline: spectral subtraction, knock detection, gating.
 * Returns the cleaned audio (what playback uses) and detected knock windows.
 */
export function cleanRecording(samples: Float32Array, sampleRate: number): CleanResult {
  const denoised = spectralSubtract(samples);
  const knocks = detectKnocks(denoised, sampleRate);
  const cleaned = gateOutsideKnocks(denoised, sampleRate, knocks);
  return { cleaned, knocks };
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Extract the pitch/hollowness feature vector from a single knock window.
 *
 * - dominantFreqHz: the main resonance ("pitch") of the melon body
 * - spectralCentroidHz / spectralRolloffHz: overall brightness
 * - lowBandRatio / midBandRatio: where the energy sits (hollow, ripe melons
 *   resonate strongly in the low band; dense/overripe ones thud broadband)
 * - spectralFlatness: tonal resonance vs. dull noise-like thud
 * - resonanceQ: sharpness of the dominant resonance peak
 * - decayTimeMs: how long the melon rings (hollow melons ring longer)
 */
export function extractKnockFeatures(
  samples: Float32Array,
  sampleRate: number,
  knock: KnockWindow
): number[] {
  const seg = samples.subarray(knock.start, knock.end);
  const size = Math.min(4096, nextPow2(seg.length));

  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const window = hannWindow(Math.min(seg.length, size));
  for (let i = 0; i < Math.min(seg.length, size); i++) re[i] = seg[i] * window[i];
  fft(re, im);

  const bins = size / 2;
  const binHz = sampleRate / size;
  const mag = new Float64Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]);

  // Consider 40 Hz – 4 kHz (knock energy lives well below 4 kHz).
  const kMin = Math.max(1, Math.round(40 / binHz));
  const kMax = Math.min(bins - 1, Math.round(4000 / binHz));

  let total = 0;
  let weighted = 0;
  let peakVal = 0;
  let peakBin = kMin;
  let low = 0; // < 350 Hz
  let mid = 0; // 350–900 Hz
  let logSum = 0;
  let count = 0;

  const kLow = Math.round(350 / binHz);
  const kMid = Math.round(900 / binHz);

  for (let k = kMin; k <= kMax; k++) {
    const m = mag[k];
    const e = m * m;
    total += e;
    weighted += e * k * binHz;
    if (m > peakVal) {
      peakVal = m;
      peakBin = k;
    }
    if (k <= kLow) low += e;
    else if (k <= kMid) mid += e;
    logSum += Math.log(m + 1e-12);
    count++;
  }

  if (total < 1e-12) return [0, 0, 0, 0, 0, 0, 0, 0];

  const dominantFreq = peakBin * binHz;
  const centroid = weighted / total;

  // 85% rolloff
  let cum = 0;
  let rolloff = kMax * binHz;
  for (let k = kMin; k <= kMax; k++) {
    cum += mag[k] * mag[k];
    if (cum >= 0.85 * total) {
      rolloff = k * binHz;
      break;
    }
  }

  const lowRatio = low / total;
  const midRatio = mid / total;

  // Spectral flatness: geometric mean / arithmetic mean of magnitudes.
  const geoMean = Math.exp(logSum / count);
  const ariMean = Math.sqrt(total / count);
  const flatness = Math.min(1, geoMean / (ariMean + 1e-12));

  // Q of the dominant peak: peak frequency / -3 dB bandwidth.
  const halfPower = peakVal / Math.SQRT2;
  let lo = peakBin;
  let hi = peakBin;
  while (lo > kMin && mag[lo] > halfPower) lo--;
  while (hi < kMax && mag[hi] > halfPower) hi++;
  const bandwidth = Math.max(1, hi - lo) * binHz;
  const q = dominantFreq / bandwidth;

  // Decay time: envelope peak -> -20 dB, in ms.
  const blockSize = Math.max(16, Math.round(sampleRate * 0.002));
  const env = envelope(seg, blockSize);
  let envPeakIdx = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[envPeakIdx]) envPeakIdx = i;
  const target = env[envPeakIdx] * 0.1; // -20 dB
  let decayBlocks = env.length - envPeakIdx;
  for (let i = envPeakIdx; i < env.length; i++) {
    if (env[i] <= target) {
      decayBlocks = i - envPeakIdx;
      break;
    }
  }
  const decayMs = (decayBlocks * blockSize * 1000) / sampleRate;

  return [dominantFreq, centroid, rolloff, lowRatio, midRatio, flatness, q, decayMs];
}

/**
 * Feature vector for a whole recording: the average across all detected
 * knocks (a user knocks a few times per melon).
 */
export function extractRecordingFeatures(
  samples: Float32Array,
  sampleRate: number,
  knocks: KnockWindow[]
): number[] | null {
  if (knocks.length === 0) return null;
  const acc = new Array(FEATURE_COUNT).fill(0);
  for (const knock of knocks) {
    const f = extractKnockFeatures(samples, sampleRate, knock);
    for (let i = 0; i < FEATURE_COUNT; i++) acc[i] += f[i];
  }
  return acc.map((v) => v / knocks.length);
}
