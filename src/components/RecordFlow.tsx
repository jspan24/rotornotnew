import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cleanRecording, extractRecordingFeatures } from '../audio/dsp';
import { playSamples, stopPlayback } from '../audio/player';
import { startRecording, stopRecording } from '../audio/recorder';
import { CONFIG } from '../config';
import { COLORS } from '../theme';
import LevelMeter from './LevelMeter';

export interface AcceptedRecording {
  cleaned: Float32Array;
  knockCount: number;
  features: number[];
}

type Phase = 'idle' | 'listening' | 'processing' | 'review';

/**
 * The shared record -> playback -> accept/ignore flow used by both training
 * and picking modes:
 *   Start Listening -> knock a few times (live pulsing meter) -> Stop ->
 *   optionally play back the noise-cleaned recording -> Accept or Ignore.
 */
export default function RecordFlow({
  accentColor,
  idleHint,
  onAccept,
  onReset,
}: {
  accentColor: string;
  idleHint: string;
  onAccept: (rec: AcceptedRecording) => void;
  onReset?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<AcceptedRecording | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopPlayback().catch(() => {});
    };
  }, []);

  const begin = useCallback(async () => {
    try {
      onReset?.();
      setResult(null);
      await startRecording((lvl) => {
        if (mounted.current) setLevel(lvl);
      });
      setPhase('listening');
    } catch (e) {
      Alert.alert('Microphone', e instanceof Error ? e.message : 'Could not start recording.');
    }
  }, [onReset]);

  const finish = useCallback(async () => {
    setPhase('processing');
    setLevel(0);
    try {
      const raw = await stopRecording();
      // Noise cleanup + knock detection can take a moment; let the spinner paint.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const { cleaned, knocks } = cleanRecording(raw, CONFIG.SAMPLE_RATE);
      const features = extractRecordingFeatures(cleaned, CONFIG.SAMPLE_RATE, knocks);
      if (!mounted.current) return;
      if (!features || knocks.length === 0) {
        setPhase('idle');
        Alert.alert(
          'No knocks heard',
          'I could not pick out any knocks over the background noise. Try knocking harder, closer to the mic.'
        );
        return;
      }
      setResult({ cleaned, knockCount: knocks.length, features });
      setPhase('review');
    } catch (e) {
      if (!mounted.current) return;
      setPhase('idle');
      Alert.alert('Recording', e instanceof Error ? e.message : 'Recording failed.');
    }
  }, []);

  const playback = useCallback(async () => {
    if (!result) return;
    if (playing) {
      await stopPlayback();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    await playSamples(result.cleaned, CONFIG.SAMPLE_RATE, () => {
      if (mounted.current) setPlaying(false);
    });
  }, [result, playing]);

  const accept = useCallback(async () => {
    if (!result) return;
    await stopPlayback();
    setPlaying(false);
    setPhase('idle');
    onAccept(result);
    setResult(null);
  }, [result, onAccept]);

  const ignore = useCallback(async () => {
    await stopPlayback();
    setPlaying(false);
    setResult(null);
    setPhase('idle');
  }, []);

  if (phase === 'listening') {
    return (
      <View style={styles.box}>
        <Text style={styles.listening}>Listening… knock on the watermelon</Text>
        <LevelMeter level={level} />
        <TouchableOpacity style={[styles.bigBtn, { backgroundColor: COLORS.red }]} onPress={finish}>
          <Text style={styles.bigBtnText}>■ Stop Listening</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'processing') {
    return (
      <View style={styles.box}>
        <ActivityIndicator size="large" color={accentColor} />
        <Text style={styles.dim}>Cleaning up background noise…</Text>
      </View>
    );
  }

  if (phase === 'review' && result) {
    return (
      <View style={styles.box}>
        <Text style={styles.knocks}>
          {result.knockCount} knock{result.knockCount === 1 ? '' : 's'} detected
        </Text>
        <TouchableOpacity style={[styles.bigBtn, { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border }]} onPress={playback}>
          <Text style={styles.bigBtnText}>{playing ? '■ Stop' : '▶ Play cleaned recording'}</Text>
        </TouchableOpacity>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.halfBtn, { backgroundColor: accentColor }]} onPress={accept}>
            <Text style={styles.bigBtnText}>✓ Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.halfBtn, { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border }]} onPress={ignore}>
            <Text style={styles.bigBtnText}>✕ Ignore</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.dim}>{idleHint}</Text>
      <TouchableOpacity style={[styles.bigBtn, { backgroundColor: accentColor }]} onPress={begin}>
        <Text style={styles.bigBtnText}>● Start Listening</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  bigBtn: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    minWidth: 240,
    alignItems: 'center',
  },
  halfBtn: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14,
    minWidth: 114,
    alignItems: 'center',
  },
  bigBtnText: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
  },
  listening: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  knocks: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  dim: {
    color: COLORS.dim,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
