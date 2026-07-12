/**
 * The local watermelon-scoring model.
 *
 * Model choice: a compact fully-connected neural network (8 -> 16 -> 8 -> 1)
 * over DSP-extracted acoustic features (dominant pitch, band-energy balance,
 * spectral flatness, resonance Q, decay time). For a personally collected
 * dataset (tens to hundreds of knock samples) this comfortably outperforms a
 * large raw-audio network, trains on-device in under a second, is completely
 * free/offline, runs identically on Android and iOS (pure TypeScript — no
 * native ML runtime needed), and serializes to a few-KB JSON blob that is
 * trivial to bundle with the app and sync through the cloud.
 */

import { FEATURE_COUNT } from '../audio/dsp';

export interface TrainedModel {
  version: 1;
  trainedAt: number; // epoch ms — used to decide which model is newest
  sampleCount: number;
  featureMean: number[];
  featureStd: number[];
  layers: { weights: number[][]; biases: number[] }[];
}

const HIDDEN = [16, 8];

// Deterministic PRNG so retraining on the same data gives the same model.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tanh(x: number): number {
  return Math.tanh(x);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface Net {
  w: number[][][]; // [layer][out][in]
  b: number[][]; // [layer][out]
}

function initNet(rand: () => number): Net {
  const sizes = [FEATURE_COUNT, ...HIDDEN, 1];
  const w: number[][][] = [];
  const b: number[][] = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const scale = Math.sqrt(2 / sizes[l]);
    w.push(
      Array.from({ length: sizes[l + 1] }, () =>
        Array.from({ length: sizes[l] }, () => (rand() * 2 - 1) * scale)
      )
    );
    b.push(new Array(sizes[l + 1]).fill(0));
  }
  return { w, b };
}

/** Forward pass; returns activations per layer (including input). */
function forward(net: Net, x: number[]): number[][] {
  const acts: number[][] = [x];
  let cur = x;
  for (let l = 0; l < net.w.length; l++) {
    const next = new Array<number>(net.w[l].length);
    const isOutput = l === net.w.length - 1;
    for (let j = 0; j < net.w[l].length; j++) {
      let z = net.b[l][j];
      const row = net.w[l][j];
      for (let i = 0; i < row.length; i++) z += row[i] * cur[i];
      next[j] = isOutput ? sigmoid(z) : tanh(z);
    }
    acts.push(next);
    cur = next;
  }
  return acts;
}

function standardize(x: number[], mean: number[], std: number[]): number[] {
  return x.map((v, i) => (v - mean[i]) / std[i]);
}

export interface TrainProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
}

/**
 * Train the scoring network on all collected samples.
 * features: one 8-dim vector per sample; scores: 1..100.
 */
export async function trainModel(
  features: number[][],
  scores: number[],
  onProgress?: (p: TrainProgress) => void
): Promise<TrainedModel> {
  const n = features.length;
  if (n < 5) {
    throw new Error(`Need at least 5 samples to train (have ${n}).`);
  }

  // Feature standardization stats.
  const mean = new Array(FEATURE_COUNT).fill(0);
  const std = new Array(FEATURE_COUNT).fill(0);
  for (const f of features) for (let i = 0; i < FEATURE_COUNT; i++) mean[i] += f[i];
  for (let i = 0; i < FEATURE_COUNT; i++) mean[i] /= n;
  for (const f of features)
    for (let i = 0; i < FEATURE_COUNT; i++) std[i] += (f[i] - mean[i]) ** 2;
  for (let i = 0; i < FEATURE_COUNT; i++) std[i] = Math.max(Math.sqrt(std[i] / n), 1e-6);

  const X = features.map((f) => standardize(f, mean, std));
  const Y = scores.map((s) => (s - 1) / 99); // map 1..100 -> 0..1

  const rand = mulberry32(42);
  const net = initNet(rand);

  // Adam optimizer state.
  const mW = net.w.map((l) => l.map((r) => r.map(() => 0)));
  const vW = net.w.map((l) => l.map((r) => r.map(() => 0)));
  const mB = net.b.map((l) => l.map(() => 0));
  const vB = net.b.map((l) => l.map(() => 0));

  const LR = 0.01;
  const B1 = 0.9;
  const B2 = 0.999;
  const EPS = 1e-8;
  const EPOCHS = 600;

  let t = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    t++;
    // Full-batch gradients (datasets here are small).
    const gW = net.w.map((l) => l.map((r) => r.map(() => 0)));
    const gB = net.b.map((l) => l.map(() => 0));
    let loss = 0;

    for (let s = 0; s < n; s++) {
      const acts = forward(net, X[s]);
      const out = acts[acts.length - 1][0];
      const err = out - Y[s];
      loss += err * err;

      // Backprop. Output uses sigmoid, hidden layers tanh.
      let delta = [2 * err * out * (1 - out)];
      for (let l = net.w.length - 1; l >= 0; l--) {
        const prev = acts[l];
        for (let j = 0; j < delta.length; j++) {
          gB[l][j] += delta[j];
          for (let i = 0; i < prev.length; i++) gW[l][j][i] += delta[j] * prev[i];
        }
        if (l > 0) {
          const newDelta = new Array<number>(prev.length).fill(0);
          for (let i = 0; i < prev.length; i++) {
            let sum = 0;
            for (let j = 0; j < delta.length; j++) sum += net.w[l][j][i] * delta[j];
            newDelta[i] = sum * (1 - prev[i] * prev[i]); // tanh'
          }
          delta = newDelta;
        }
      }
    }

    // Adam update.
    const corr1 = 1 - Math.pow(B1, t);
    const corr2 = 1 - Math.pow(B2, t);
    for (let l = 0; l < net.w.length; l++) {
      for (let j = 0; j < net.w[l].length; j++) {
        for (let i = 0; i < net.w[l][j].length; i++) {
          const g = gW[l][j][i] / n;
          mW[l][j][i] = B1 * mW[l][j][i] + (1 - B1) * g;
          vW[l][j][i] = B2 * vW[l][j][i] + (1 - B2) * g * g;
          net.w[l][j][i] -=
            (LR * (mW[l][j][i] / corr1)) / (Math.sqrt(vW[l][j][i] / corr2) + EPS);
        }
        const g = gB[l][j] / n;
        mB[l][j] = B1 * mB[l][j] + (1 - B1) * g;
        vB[l][j] = B2 * vB[l][j] + (1 - B2) * g * g;
        net.b[l][j] -= (LR * (mB[l][j] / corr1)) / (Math.sqrt(vB[l][j] / corr2) + EPS);
      }
    }

    if (epoch % 50 === 0 || epoch === EPOCHS - 1) {
      onProgress?.({ epoch: epoch + 1, totalEpochs: EPOCHS, loss: loss / n });
      // Yield to the UI thread so the progress indicator can render.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    version: 1,
    trainedAt: Date.now(),
    sampleCount: n,
    featureMean: mean,
    featureStd: std,
    layers: net.w.map((w, l) => ({ weights: w, biases: net.b[l] })),
  };
}

/** Score a feature vector with a trained model. Returns 1..100. */
export function predict(model: TrainedModel, features: number[]): number {
  const net: Net = {
    w: model.layers.map((l) => l.weights),
    b: model.layers.map((l) => l.biases),
  };
  const x = standardize(features, model.featureMean, model.featureStd);
  const acts = forward(net, x);
  const out = acts[acts.length - 1][0];
  return Math.round(1 + out * 99);
}

/**
 * Rule-based fallback used only when no trained model exists yet (fresh
 * install with no cloud model published). Encodes the folk wisdom the model
 * is meant to learn: a good melon gives a hollow, resonant, low-mid pitched
 * ring; a bad one gives a dull, quickly-dying thud.
 */
export function heuristicScore(features: number[]): number {
  const [dominantFreq, , , lowRatio, , flatness, q, decayMs] = features;

  // Ideal hollow ring sits roughly 100–250 Hz.
  const pitchScore =
    dominantFreq <= 0
      ? 0
      : Math.exp(-Math.pow((dominantFreq - 175) / 150, 2));
  const hollowScore = Math.min(1, lowRatio * 1.4) * (1 - Math.min(1, flatness * 2.5));
  const ringScore = Math.min(1, q / 8) * 0.5 + Math.min(1, decayMs / 120) * 0.5;

  const score = 100 * (0.4 * pitchScore + 0.35 * hollowScore + 0.25 * ringScore);
  return Math.max(1, Math.min(100, Math.round(score)));
}

export function isValidModel(m: unknown): m is TrainedModel {
  const model = m as TrainedModel | null;
  return (
    !!model &&
    model.version === 1 &&
    typeof model.trainedAt === 'number' &&
    Array.isArray(model.featureMean) &&
    model.featureMean.length === FEATURE_COUNT &&
    Array.isArray(model.layers) &&
    model.layers.length > 0
  );
}
