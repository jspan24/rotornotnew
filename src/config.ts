/**
 * App-wide configuration.
 *
 * MODEL_SYNC_URL — a REST endpoint that stores/serves the trained model as JSON.
 *   - GET  <url>  must return the published model JSON (or null if none yet)
 *   - PUT  <url>  with a JSON body publishes a new model
 *
 * A free Firebase Realtime Database works out of the box:
 *   1. Create a project at https://console.firebase.google.com (free Spark plan).
 *   2. Create a Realtime Database.
 *   3. Set MODEL_SYNC_URL to:
 *        https://<your-project>-default-rtdb.firebaseio.com/rotornot/model.json
 *   4. (Recommended) Lock writes down with database rules and set
 *      MODEL_SYNC_AUTH to a database secret / auth token; it is appended
 *      as ?auth=<token> on writes.
 *
 * Leave MODEL_SYNC_URL empty to run fully offline (training and picking
 * still work on-device; only cloud publish/fetch is disabled).
 */
export const CONFIG = {
  MODEL_SYNC_URL: '',
  MODEL_SYNC_AUTH: '',

  /** Mic capture settings — 16 kHz mono is plenty for knock transients. */
  SAMPLE_RATE: 16000,

  /** Max recording length (safety stop), seconds. */
  MAX_RECORD_SECONDS: 20,
};
