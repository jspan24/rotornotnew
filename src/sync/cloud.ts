import { CONFIG } from '../config';
import { TrainedModel, isValidModel } from '../ml/model';

/**
 * Cloud model sync over plain REST (Firebase Realtime Database compatible —
 * see src/config.ts for setup). The trainer phone publishes its trained
 * model; every phone fetches the published model on app start.
 */

export function syncConfigured(): boolean {
  return CONFIG.MODEL_SYNC_URL.length > 0;
}

function urlWithAuth(): string {
  if (!CONFIG.MODEL_SYNC_AUTH) return CONFIG.MODEL_SYNC_URL;
  const sep = CONFIG.MODEL_SYNC_URL.includes('?') ? '&' : '?';
  return `${CONFIG.MODEL_SYNC_URL}${sep}auth=${encodeURIComponent(CONFIG.MODEL_SYNC_AUTH)}`;
}

/** Publish the trained model so every install picks it up on next launch. */
export async function publishModel(model: TrainedModel): Promise<void> {
  if (!syncConfigured()) {
    throw new Error('Cloud sync is not configured (set MODEL_SYNC_URL in src/config.ts).');
  }
  const res = await fetch(urlWithAuth(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!res.ok) {
    throw new Error(`Publish failed: HTTP ${res.status}`);
  }
}

/** Fetch the currently published model, or null if none / sync disabled. */
export async function fetchPublishedModel(): Promise<TrainedModel | null> {
  if (!syncConfigured()) return null;
  try {
    const res = await fetch(CONFIG.MODEL_SYNC_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    return isValidModel(json) ? json : null;
  } catch {
    return null; // offline — keep using the local/bundled model
  }
}
