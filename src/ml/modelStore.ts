import * as FileSystem from 'expo-file-system';
import { TrainedModel, isValidModel } from './model';

/**
 * Local persistence for the trained model, plus the model bundled with the
 * app build. Resolution order when the app starts:
 *   1. freshest of {locally stored model, cloud model} (cloud checked in App)
 *   2. model bundled in assets/pretrained-model.json (shipped with the app)
 *   3. none -> picking mode falls back to the built-in heuristic
 */

const MODEL_FILE = `${FileSystem.documentDirectory}model.json`;

// Bundled with the app binary. Replace this file with a published model JSON
// before shipping so first-run users can score melons before their first sync.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bundled = require('../../assets/pretrained-model.json');

export function bundledModel(): TrainedModel | null {
  return isValidModel(bundled) ? bundled : null;
}

export async function loadLocalModel(): Promise<TrainedModel | null> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(MODEL_FILE);
    const parsed = JSON.parse(raw);
    return isValidModel(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveLocalModel(model: TrainedModel): Promise<void> {
  await FileSystem.writeAsStringAsync(MODEL_FILE, JSON.stringify(model));
}
