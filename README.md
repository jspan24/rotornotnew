# 🍉 Rot or Not

A cross-platform (Android + iOS) mobile app that scores watermelons by the
sound they make when you knock on them. Built with Expo / React Native /
TypeScript.

## The two modes

**Training Mode** — for the model trainer:

1. Tap **Start Listening**, knock on a watermelon a couple of times, tap
   **Stop Listening**. A pulsing sound-bar meter confirms the mic is picking
   up your knocks.
2. Play back the noise-cleaned recording, then **Accept** or **Ignore** it.
3. After accepting, rate the melon **1–100** on a slider (1 = worst,
   100 = best) and save. Each sample is stored on the phone with its
   timestamp, score, cleaned audio, and acoustic features.
4. Repeat for many melons. Manage (play back / delete) collected samples any
   time under **Manage collected samples**.
5. Tap **Train model** — the model is (re)trained from scratch on *all*
   samples stored on the phone, old and new. You can retrain any time after
   collecting more samples.
6. Tap **Publish model to cloud** — every phone running the app automatically
   syncs to the newest published model on its next app start.

**Picking Mode** — for everyone:

1. Start listening, knock, stop — same meter, same playback + accept/ignore
   review of the cleaned recording.
2. On accept, the latest trained model scores the melon 1–100 with a verdict.
   If no trained model exists yet (fresh install, nothing published), a
   built-in acoustic heuristic is used and the UI says so.

## How it works

### Grocery-store noise removal

Both modes record raw 16 kHz PCM and run a two-stage cleanup, chosen because
store noise (HVAC rumble, chatter, music) is *sustained* while knocks are
*impulsive*:

1. **Adaptive spectral subtraction** — the quietest 25% of frames in each
   recording are used to estimate the background-noise spectrum of the store
   the user is actually standing in; that spectrum is subtracted from every
   frame (with over-subtraction and a spectral floor to avoid musical-noise
   artifacts).
2. **Transient gating** — knock onsets are detected on the energy envelope
   (impulses that tower over the recording's own noise floor); everything
   outside a 10 ms pre-roll → 300 ms ring-down window around each knock is
   attenuated by ~34 dB with short fades.

Playback always plays this cleaned audio, and features are extracted from it,
so training and scoring see the same clean knocks. On Android the mic is
opened with the `VOICE_RECOGNITION` source to avoid OS processing that would
smear the knock transients.

### The model

A compact fully-connected neural network (8 → 16 → 8 → 1, trained with Adam)
over 8 DSP-extracted acoustic features per knock, averaged across the knocks
in a recording:

| Feature | What it captures |
| --- | --- |
| dominant frequency | the melon's main resonance — the "pitch" of the knock |
| spectral centroid, rolloff | overall brightness |
| low/mid band-energy ratios | hollowness: ripe melons resonate low, dense ones thud broadband |
| spectral flatness | tonal ring vs. dull noise-like thud |
| resonance Q | sharpness of the resonance peak |
| decay time | how long the melon rings |

Why this instead of a big audio network (YAMNet-style embeddings, CNN on
spectrograms, etc.): the training set is personally collected — tens to a few
hundred samples — where a small model on physics-informed features generalizes
far better than a deep net on raw audio. It is completely free, trains
on-device in under a second, runs identically on Android and iOS (pure
TypeScript — no native ML runtime to bundle per platform), and serializes to a
few-KB JSON that is trivial to ship inside the app and sync through the cloud.
The training entry point is isolated in `src/ml/model.ts`, so it can be swapped
for a TFLite/Core ML backend later without touching the rest of the app.

The whole pipeline is validated by an offline test (synthetic knocks in
simulated store noise): knock detection finds 3/3 knocks, background RMS drops
~56 dB after cleanup, and the trained model separates good/bad held-out melons
(97 vs. 7).

### Model distribution

- The published model JSON is bundled with the app build
  (`assets/pretrained-model.json`) so fresh installs work immediately.
- On every app start the app fetches the cloud model and switches to it if it
  is newer than what is on the phone — so a retrain + republish reaches all
  users automatically.

## Cloud sync setup (one-time)

Any endpoint that supports `GET`/`PUT` of a JSON document works. A free
Firebase Realtime Database is the zero-code option:

1. Create a project at <https://console.firebase.google.com> (free Spark plan)
   and add a **Realtime Database**.
2. In `src/config.ts` set:
   ```ts
   MODEL_SYNC_URL: 'https://<your-project>-default-rtdb.firebaseio.com/rotornot/model.json'
   ```
3. Recommended: restrict writes in the database rules and put the auth token
   in `MODEL_SYNC_AUTH` (appended as `?auth=` on publish) so only the trainer
   phone can publish.

Leave `MODEL_SYNC_URL` empty to run fully offline — everything except cloud
publish/fetch still works.

## Running on your Android phone

The app uses a native mic module, so it needs a development build (not Expo
Go):

```bash
npm install
npx expo run:android        # phone connected via USB with USB-debugging on
```

Requires a local Android SDK (Android Studio). For iOS later:
`npx expo run:ios` on a Mac, or build both with EAS:
`npx eas build --platform android` / `--platform ios`.

## Code map

```
App.tsx                     app shell, mode navigation, startup model sync
src/config.ts               sync endpoint + audio settings
src/audio/recorder.ts       raw PCM capture + live level for the meter
src/audio/dsp.ts            FFT, spectral subtraction, knock detection/gating,
                            feature extraction
src/audio/wav.ts            WAV encode/decode
src/audio/player.ts         playback of cleaned audio / stored samples
src/ml/model.ts             neural-net regressor: train / predict / heuristic
src/ml/modelStore.ts        local + bundled model persistence
src/storage/samples.ts      training-sample store (WAV + score + timestamp)
src/sync/cloud.ts           publish / fetch the model JSON
src/components/RecordFlow.tsx  shared listen → meter → playback → accept flow
src/components/LevelMeter.tsx  pulsing sound-bar indicator
src/screens/*.tsx           Home, Training, Picking, Samples screens
```
