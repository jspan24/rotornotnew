import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { encodeWavBase64 } from './wav';

let currentSound: Audio.Sound | null = null;

async function playUri(uri: string, onDone?: () => void): Promise<void> {
  await stopPlayback();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  currentSound = sound;
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      sound.unloadAsync().catch(() => {});
      if (currentSound === sound) currentSound = null;
      onDone?.();
    }
  });
}

/** Play float samples by writing a temporary WAV to the cache directory. */
export async function playSamples(
  samples: Float32Array,
  sampleRate: number,
  onDone?: () => void
): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}playback.wav`;
  await FileSystem.writeAsStringAsync(uri, encodeWavBase64(samples, sampleRate), {
    encoding: FileSystem.EncodingType.Base64,
  });
  await playUri(uri, onDone);
}

/** Play a stored WAV file. */
export async function playFile(uri: string, onDone?: () => void): Promise<void> {
  await playUri(uri, onDone);
}

export async function stopPlayback(): Promise<void> {
  if (currentSound) {
    const s = currentSound;
    currentSound = null;
    try {
      await s.stopAsync();
      await s.unloadAsync();
    } catch {
      // already unloaded
    }
  }
}
