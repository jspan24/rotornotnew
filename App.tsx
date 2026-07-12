import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { TrainedModel } from './src/ml/model';
import { bundledModel, loadLocalModel, saveLocalModel } from './src/ml/modelStore';
import HomeScreen from './src/screens/HomeScreen';
import PickingScreen from './src/screens/PickingScreen';
import SamplesScreen from './src/screens/SamplesScreen';
import TrainingScreen from './src/screens/TrainingScreen';
import { fetchPublishedModel, syncConfigured } from './src/sync/cloud';
import { COLORS } from './src/theme';

type Screen = 'home' | 'train' | 'pick' | 'samples';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [model, setModel] = useState<TrainedModel | null>(null);
  const [syncStatus, setSyncStatus] = useState('Sync: checking…');

  // On every app start: use the freshest of local / bundled / cloud models,
  // so newly published models reach every phone automatically.
  useEffect(() => {
    (async () => {
      let best: TrainedModel | null = (await loadLocalModel()) ?? bundledModel();
      setModel(best);

      if (!syncConfigured()) {
        setSyncStatus('Sync: not configured (offline mode)');
        return;
      }
      const remote = await fetchPublishedModel();
      if (remote && (!best || remote.trainedAt > best.trainedAt)) {
        best = remote;
        setModel(remote);
        await saveLocalModel(remote);
        setSyncStatus(`Sync: updated to cloud model (${new Date(remote.trainedAt).toLocaleString()})`);
      } else if (remote) {
        setSyncStatus('Sync: up to date with cloud');
      } else {
        setSyncStatus('Sync: no model published to the cloud yet');
      }
    })().catch(() => setSyncStatus('Sync: unreachable — using local model'));
  }, []);

  const goHome = useCallback(() => setScreen('home'), []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {screen === 'home' && (
        <HomeScreen
          model={model}
          syncStatus={syncStatus}
          onTraining={() => setScreen('train')}
          onPicking={() => setScreen('pick')}
        />
      )}
      {screen === 'train' && (
        <TrainingScreen
          model={model}
          onModelTrained={setModel}
          onBack={goHome}
          onManageSamples={() => setScreen('samples')}
        />
      )}
      {screen === 'pick' && <PickingScreen model={model} onBack={goHome} />}
      {screen === 'samples' && <SamplesScreen onBack={() => setScreen('train')} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
});
