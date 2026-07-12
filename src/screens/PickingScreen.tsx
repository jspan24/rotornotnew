import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RecordFlow, { AcceptedRecording } from '../components/RecordFlow';
import { TrainedModel, heuristicScore, predict } from '../ml/model';
import { COLORS } from '../theme';

function verdict(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Excellent pick! 🍉', color: COLORS.green };
  if (score >= 60) return { label: 'Pretty good melon', color: '#9dd63d' };
  if (score >= 40) return { label: 'Average — keep looking', color: COLORS.yellow };
  if (score >= 20) return { label: 'Not great', color: '#f08c3a' };
  return { label: 'Rot! Put it back 🤢', color: COLORS.red };
}

/**
 * Picking mode: knock, accept the cleaned recording, and get a 1-100 score
 * from the latest trained model.
 */
export default function PickingScreen({
  model,
  onBack,
}: {
  model: TrainedModel | null;
  onBack: () => void;
}) {
  const [result, setResult] = useState<{ score: number; usedHeuristic: boolean } | null>(null);

  const onAccept = useCallback(
    (rec: AcceptedRecording) => {
      if (model) {
        setResult({ score: predict(model, rec.features), usedHeuristic: false });
      } else {
        setResult({ score: heuristicScore(rec.features), usedHeuristic: true });
      }
    },
    [model]
  );

  const v = result ? verdict(result.score) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Picking Mode</Text>

      {result && v && (
        <View style={[styles.resultCard, { borderColor: v.color }]}>
          <Text style={styles.resultLabel}>Watermelon score</Text>
          <Text style={[styles.resultScore, { color: v.color }]}>{result.score}</Text>
          <Text style={[styles.resultVerdict, { color: v.color }]}>{v.label}</Text>
          {result.usedHeuristic && (
            <Text style={styles.heuristicNote}>
              No trained model is available yet — this score uses the built-in
              acoustic rule of thumb. It will switch to the trained model
              automatically after the next sync.
            </Text>
          )}
        </View>
      )}

      <View style={styles.card}>
        <RecordFlow
          accentColor={COLORS.pink}
          idleHint="Knock on a watermelon a couple of times and I'll score it."
          onAccept={onAccept}
          onReset={() => setResult(null)}
        />
      </View>

      {model && (
        <Text style={styles.dim}>
          Using model trained {new Date(model.trainedAt).toLocaleString()} on{' '}
          {model.sampleCount} samples.
        </Text>
      )}
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
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
  },
  resultLabel: { color: COLORS.dim, fontSize: 14 },
  resultScore: { fontSize: 64, fontWeight: '900' },
  resultVerdict: { fontSize: 18, fontWeight: '700' },
  heuristicNote: {
    color: COLORS.yellow,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  dim: { color: COLORS.dim, fontSize: 13, textAlign: 'center' },
});
