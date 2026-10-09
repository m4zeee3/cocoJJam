import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/brand';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEMO_MODE, loadModel } from '@/ml/classifier';

/** How long the splash stays up on every launch (longer only if the model is still loading). */
const SPLASH_MS = 2000;
const BAR_WIDTH = 200;

/**
 * 01 Splash: loads the on-device model into memory while it's shown, so the
 * first scan is instant, then fades out over the app (which is already
 * rendering underneath). The bar fills to ~85% over the minimum time and
 * completes when the model is ready. Expo Go has no model, so there it just waits.
 */
export function AppSplash() {
  const theme = useTheme();
  const [done, setDone] = useState(false);
  // Created once and kept for the component's life.
  const [fade] = useState(() => new Animated.Value(1));
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const min = SPLASH_MS;
      Animated.timing(progress, { toValue: 0.85, duration: min, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
      const wait = new Promise((r) => setTimeout(r, min));
      // A model that fails to load is reported when scanning; don't block the app here.
      const model = DEMO_MODE ? Promise.resolve() : loadModel().catch(() => {});
      await Promise.all([wait, model]);
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(fade, { toValue: 0, duration: 280, useNativeDriver: false }),
      ]).start(() => setDone(true));
    })();
    return () => {
      cancelled = true;
    };
  }, [fade, progress]);

  if (done) return null;

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: [0, BAR_WIDTH] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.background, opacity: fade }]}>
      <View style={styles.center}>
        <View style={styles.glow}>
          <Image source={require('@/assets/images/brand-logo.png')} style={styles.logo} contentFit="contain" />
        </View>
        <ThemedText type="title" style={styles.name}>
          {BRAND.first}
          <ThemedText type="title" themeColor="tint" style={styles.name}>
            {BRAND.second}
          </ThemedText>
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {BRAND.tagline}
        </ThemedText>
      </View>

      <View style={styles.bottom}>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <Animated.View style={[styles.bar, { backgroundColor: theme.tint, width }]} />
        </View>
        <ThemedText type="smallBold">Loading on-device AI model…</ThemedText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 100, alignItems: 'center', paddingTop: Spacing.six, paddingBottom: Spacing.six + Spacing.three },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  // Soft orange glow behind the logo, as in the FigJam splash.
  glow: {
    borderRadius: 28,
    marginBottom: Spacing.three,
    shadowColor: '#EA580C',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  logo: { width: 112, height: 112 },
  name: { fontFamily: Fonts.extraBold, fontSize: 32, lineHeight: 38 },
  bottom: { alignItems: 'center', gap: Spacing.one + 2 },
  track: { width: BAR_WIDTH, height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: Spacing.two },
  bar: { height: 6, borderRadius: 3 },
});
