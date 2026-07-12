import * as FileSystem from 'expo-file-system';
import { CONFIG } from '../config';
import { encodeWavBase64 } from '../audio/wav';

/**
 * On-device training-sample store. Each accepted recording is saved as a
 * cleaned WAV file plus an index entry carrying its timestamp, the 1-100
 * score, and the pre-computed feature vector used for training.
 */

export interface SampleMeta {
  id: string;
  timestamp: number; // epoch ms
  score: number; // 1..100
  knockCount: number;
  features: number[];
}

const DIR = `${FileSystem.documentDirectory}samples/`;
const INDEX = `${DIR}index.json`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

export async function listSamples(): Promise<SampleMeta[]> {
  await ensureDir();
  const info = await FileSystem.getInfoAsync(INDEX);
  if (!info.exists) return [];
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX);
    const list = JSON.parse(raw) as SampleMeta[];
    return list.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

async function writeIndex(list: SampleMeta[]): Promise<void> {
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(list));
}

export function sampleWavUri(id: string): string {
  return `${DIR}${id}.wav`;
}

export async function saveSample(
  cleaned: Float32Array,
  score: number,
  knockCount: number,
  features: number[]
): Promise<SampleMeta> {
  await ensureDir();
  const meta: SampleMeta = {
    id: `s${Date.now()}`,
    timestamp: Date.now(),
    score,
    knockCount,
    features,
  };
  await FileSystem.writeAsStringAsync(
    sampleWavUri(meta.id),
    encodeWavBase64(cleaned, CONFIG.SAMPLE_RATE),
    { encoding: FileSystem.EncodingType.Base64 }
  );
  const list = await listSamples();
  list.push(meta);
  await writeIndex(list);
  return meta;
}

export async function deleteSample(id: string): Promise<void> {
  const list = await listSamples();
  await writeIndex(list.filter((s) => s.id !== id));
  await FileSystem.deleteAsync(sampleWavUri(id), { idempotent: true });
}
