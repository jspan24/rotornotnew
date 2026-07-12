import { PermissionsAndroid, Platform } from 'react-native';
import AudioRecord from 'react-native-audio-record';
import { CONFIG } from '../config';
import { pcm16Base64ToFloat } from './wav';

/**
 * Raw PCM microphone capture. Chunks stream in while recording so the UI can
 * show a live level meter; on stop, the full recording is returned as float
 * samples for the DSP pipeline.
 */

let initialized = false;
let recording = false;
let chunks: Float32Array[] = [];
let levelCallback: ((level: number) => void) | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

function ensureInit(): void {
  if (initialized) return;
  AudioRecord.init({
    sampleRate: CONFIG.SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    // Android audio source 6 = VOICE_RECOGNITION: raw-ish input without
    // aggressive processing that would smear knock transients.
    audioSource: 6,
    wavFile: 'rotornot-last.wav',
  });
  AudioRecord.on('data', (base64) => {
    if (!recording) return;
    const floats = pcm16Base64ToFloat(base64);
    chunks.push(floats);
    if (levelCallback) {
      let sum = 0;
      for (let i = 0; i < floats.length; i++) sum += floats[i] * floats[i];
      const rms = Math.sqrt(sum / Math.max(1, floats.length));
      // Perceptual-ish scaling so quiet store ambience barely moves the bars
      // but knocks slam them.
      levelCallback(Math.min(1, Math.pow(rms * 6, 0.6)));
    }
  });
  initialized = true;
}

export async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS prompts via Info.plist on first use
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone access',
      message: 'Rot or Not needs the microphone to hear your watermelon knocks.',
      buttonPositive: 'OK',
    }
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function startRecording(onLevel: (level: number) => void): Promise<void> {
  const ok = await requestMicPermission();
  if (!ok) throw new Error('Microphone permission denied');
  ensureInit();
  chunks = [];
  levelCallback = onLevel;
  recording = true;
  AudioRecord.start();
  autoStopTimer = setTimeout(() => {
    if (recording) recording = false;
  }, CONFIG.MAX_RECORD_SECONDS * 1000);
}

export async function stopRecording(): Promise<Float32Array> {
  recording = false;
  levelCallback = null;
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
  await AudioRecord.stop();

  let total = 0;
  for (const c of chunks) total += c.length;
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  chunks = [];
  return all;
}
