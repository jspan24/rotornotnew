import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { playFile, stopPlayback } from '../audio/player';
import { SampleMeta, deleteSample, listSamples, sampleWavUri } from '../storage/samples';
import { COLORS } from '../theme';

/** Browse, play back, and delete the training samples stored on this phone. */
export default function SamplesScreen({ onBack }: { onBack: () => void }) {
  const [samples, setSamples] = useState<SampleMeta[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSamples(await listSamples());
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      stopPlayback().catch(() => {});
    };
  }, [refresh]);

  const togglePlay = useCallback(
    async (s: SampleMeta) => {
      if (playingId === s.id) {
        await stopPlayback();
        setPlayingId(null);
        return;
      }
      setPlayingId(s.id);
      await playFile(sampleWavUri(s.id), () => setPlayingId(null));
    },
    [playingId]
  );

  const remove = useCallback(
    (s: SampleMeta) => {
      Alert.alert('Delete sample?', `Score ${s.score}, ${new Date(s.timestamp).toLocaleString()}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (playingId === s.id) await stopPlayback();
            await deleteSample(s.id);
            await refresh();
          },
        },
      ]);
    },
    [playingId, refresh]
  );

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Collected Samples</Text>
      <Text style={styles.dim}>
        {samples.length} sample{samples.length === 1 ? '' : 's'} stored on this phone
      </Text>
      <FlatList
        data={samples}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.dim, styles.empty]}>
            No samples yet — record some in Training Mode.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.score}>Score {item.score}</Text>
              <Text style={styles.dim}>{new Date(item.timestamp).toLocaleString()}</Text>
              <Text style={styles.dim}>
                {item.knockCount} knock{item.knockCount === 1 ? '' : 's'}
              </Text>
            </View>
            <TouchableOpacity style={styles.playBtn} onPress={() => togglePlay(item)}>
              <Text style={styles.btnText}>{playingId === item.id ? '■' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(item)}>
              <Text style={styles.btnText}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, padding: 20, paddingTop: 20 },
  back: { color: COLORS.dim, fontSize: 16, marginBottom: 4 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800' },
  dim: { color: COLORS.dim, fontSize: 13 },
  list: { paddingVertical: 14, gap: 10 },
  empty: { textAlign: 'center', paddingTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  info: { flex: 1, gap: 2 },
  score: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  playBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    backgroundColor: COLORS.red,
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
});
