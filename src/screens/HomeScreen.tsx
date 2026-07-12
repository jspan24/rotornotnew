import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TrainedModel } from '../ml/model';
import { COLORS } from '../theme';

/** Startup screen: pick Training Mode or Picking Mode. */
export default function HomeScreen({
  model,
  syncStatus,
  onTraining,
  onPicking,
}: {
  model: TrainedModel | null;
  syncStatus: string;
  onTraining: () => void;
  onPicking: () => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.logo}>🍉</Text>
      <Text style={styles.title}>Rot or Not</Text>
      <Text style={styles.subtitle}>Knock. Listen. Pick the perfect watermelon.</Text>

      <TouchableOpacity style={[styles.modeBtn, styles.pickBtn]} onPress={onPicking}>
        <Text style={styles.modeTitle}>🛒 Picking Mode</Text>
        <Text style={styles.modeDesc}>Knock on a melon and get its score</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.modeBtn, styles.trainBtn]} onPress={onTraining}>
        <Text style={styles.modeTitle}>🎓 Training Mode</Text>
        <Text style={styles.modeDesc}>Teach the model what good melons sound like</Text>
      </TouchableOpacity>

      <View style={styles.status}>
        <Text style={styles.statusText}>
          {model
            ? `Model: trained ${new Date(model.trainedAt).toLocaleString()} · ${model.sampleCount} samples`
            : 'Model: none yet — picking uses the built-in acoustic heuristic'}
        </Text>
        <Text style={styles.statusText}>{syncStatus}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  logo: { fontSize: 72 },
  title: { color: COLORS.text, fontSize: 36, fontWeight: '900' },
  subtitle: { color: COLORS.dim, fontSize: 15, marginBottom: 20, textAlign: 'center' },
  modeBtn: {
    width: '100%',
    borderRadius: 18,
    padding: 22,
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickBtn: { backgroundColor: '#26333d' },
  trainBtn: { backgroundColor: '#24382c' },
  modeTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  modeDesc: { color: COLORS.dim, fontSize: 14 },
  status: { marginTop: 26, gap: 4, alignItems: 'center' },
  statusText: { color: COLORS.dim, fontSize: 12, textAlign: 'center' },
});
