import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { COLORS } from '../theme';

const BAR_COUNT = 15;

/**
 * Pulsing sound-bar meter. Bars jump with the live mic level so the user can
 * see each knock being picked up.
 */
export default function LevelMeter({ level }: { level: number }) {
  const anims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.06))
  ).current;

  useEffect(() => {
    anims.forEach((anim, i) => {
      // Center bars react strongest, edges least — classic VU look.
      const centerDist = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
      const shape = 1 - 0.65 * centerDist;
      const jitter = 0.85 + Math.random() * 0.3;
      const target = Math.max(0.06, Math.min(1, level * shape * jitter));
      Animated.timing(anim, {
        toValue: target,
        duration: 70,
        useNativeDriver: false,
      }).start();
    });
  }, [level, anims]);

  return (
    <View style={styles.row}>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height: anim.interpolate({
                inputRange: [0, 1],
                outputRange: ['6%', '100%'],
              }),
              backgroundColor: level > 0.55 ? COLORS.green : '#2f8f5c',
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 90,
    gap: 5,
    marginVertical: 16,
  },
  bar: {
    width: 10,
    borderRadius: 5,
  },
});
