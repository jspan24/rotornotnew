import Slider from '@react-native-community/slider';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RecordFlow, { AcceptedRecording } from '../components/RecordFlow';
import { TrainedModel, trainModel } from '../ml/model';
import { saveLocalModel } from '../ml/modelStore';
import { listSamples, saveSample } from '../storage/samples';
import { publishModel, syncConfigured } from '../sync/cloud';
import { COLORS } from '../theme';

/**
 * Training mode: record knocks -> accept -> score the melon 1-100 -> save.
 * Repeat across many melons, then train the model on everything collected,
 * and publish the trained model to the cloud for all users.
 */
export default function TrainingScreen({
  model,
  onModelTrained,
  onBack,
  onManageSamples,
}: {
  model: TrainedModel | null;
  onModelTrained: (m: TrainedModel) => void;
  onBack: () => void;
  onManageSamples: () => void;
}) {
  const [pending, setPending] = useState<AcceptedRecording | null>(null);
  const [score, setScore] = useState(50);
  const [sampleCount, setSampleCount] = useState(0);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState('');
  const [publishing, setPublishing] = useState(false);

  const refreshCount = useCallback(async () => {
    const list = await listSamples();
    setSampleCount(list.length);
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const onAccept = useCallback((rec: AcceptedRecording) => {
    setScore(50);
    setPending(rec);
  }, []);

  const saveScored = useCallback(async () => {
    if (!pending) return;
    await saveSample(pending.cleaned, score, pending.knockCount, pending.features);
    setPending(null);
    await refreshCount();
  }, [pending, score, refreshCount]);

  const runTraining = useCallback(async () => {
    setTraining(true);
    setProgress('Preparing samples…');
    try {
      const samples = await listSamples();
      const trained = await trainModel(
        samples.map((s) => s.features),
        samples.map((s) => s.score),
        (p) => setProgress(`Training… epoch ${p.epoch}/${p.totalEpochs} (loss ${p.loss.toFixed(4)})`)
      );
      await saveLocalModel(trained);
      onModelTrained(trained);
      Alert.alert(
        'Model trained',
        `Trained on ${trained.sampleCount} samples. Publish it to the cloud when you are happy with it.`
      );
    } catch (e) {
      Alert.alert('Training failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTraining(false);
      setProgress('');
    }
  }, [onModelTrained]);

  const publish = useCallback(async () => {
    if (!model) return;
    setPublishing(true);
    try {
      await publishModel(model);
      Alert.alert('Published', 'Every phone will pick up this model the next time the app starts.');
    } catch (e) {
      Alert.alert('Publish failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPublishing(false);
    }
  }, [model]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Training Mode</Text>

      {pending ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rate this watermelon</Text>
          <Text style={styles.scoreValue}>{score}</Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={100}
            step={1}
            value={score}
            onValueChange={setScore}
            minimumTrackTintColor={COLORS.green}
            maximumTrackTintColor={COLORS.border}
            thumbTintColor={COLORS.green}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.dim}>1 · worst</Text>
            <Text style={styles.dim}>100 · best</Text>
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={saveScored}>
            <Text style={styles.btnText}>Save sample</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPending(null)}>
            <Text style={[styles.dim, styles.discard]}>Discard</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <RecordFlow
            accentColor={COLORS.green}
            idleHint="Record a watermelon, then rate it. Collect many melons before training."
            onAccept={onAccept}
          />
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Model</Text>
        <Text style={styles.dim}>
          {sampleCount} sample{sampleCount === 1 ? '' : 's'} collected on this phone
        </Text>
        {model && (
          <Text style={styles.dim}>
            Current model: trained {new Date(model.trainedAt).toLocaleString()} on{' '}
            {model.sampleCount} samples
          </Text>
        )}
        {!!progress && <Text style={styles.progress}>{progress}</Text>}
        <TouchableOpacity
          style={[styles.primaryBtn, training && styles.disabled]}
          onPress={runTraining}
          disabled={training}
        >
          <Text style={styles.btnText}>
            {training ? 'Training…' : `Train model (${sampleCount} samples)`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, (!model || publishing) && styles.disabled]}
          onPress={publish}
          disabled={!model || publishing}
        >
          <Text style={styles.btnText}>
            {publishing ? 'Publishing…' : '☁ Publish model to cloud'}
          </Text>
        </TouchableOpacity>
        {!syncConfigured() && (
          <Text style={styles.warn}>
            Cloud sync is not configured — set MODEL_SYNC_URL in src/config.ts.
          </Text>
        )}
        <TouchableOpacity onPress={onManageSamples}>
          <Text style={styles.link}>Manage collected samples ›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  back: { color: COLORS.dim, fontSize: 16, marginBottom: 4 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  scoreValue: {
    color: COLORS.green,
    fontSize: 48,
    fontWeight: '800',
    textAlign: 'center',
  },
  slider: { width: '100%', height: 40 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  primaryBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtn: {
    backgroundColor: '#2563b0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disabled: { opacity: 0.45 },
  btnText: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  dim: { color: COLORS.dim, fontSize: 13 },
  discard: { textAlign: 'center', paddingVertical: 6, fontSize: 15 },
  progress: { color: COLORS.yellow, fontSize: 13 },
  warn: { color: COLORS.yellow, fontSize: 12 },
  link: { color: COLORS.green, fontSize: 15, paddingTop: 6 },
});
