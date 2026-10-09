import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSteady } from '@/hooks/use-steady';
import { useTheme } from '@/hooks/use-theme';
import { finishCapture } from '@/lib/camera-session';
import { MAX_PHOTOS, pickFromGallery } from '@/lib/open-scanner';
import { CAPTURE_TIPS } from '@/ml/messages';

const TIP_MS = 3500;
const WHITE = '#fff';
const DIM = 'rgba(0,0,0,0.55)';

/**
 * S02 camera (UC-1.1, 1.2): framing guide, directions for meat or fish, a steadiness
 * hint, flash and torch, and Single or Multiple mode (up to MAX_PHOTOS shots).
 * Opened through capturePhotos() in src/lib/camera-session.ts.
 */
export default function CameraScreen() {
  const { multiple } = useLocalSearchParams<{ multiple?: string }>();
  const allowMultiple = multiple === '1';
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const finished = useRef(false);
  const [mode, setMode] = useState<'single' | 'multiple'>('single');
  const [kind, setKind] = useState<'meat' | 'fish'>('meat');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [torch, setTorch] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState(0);
  const steady = useSteady();

  const tips = CAPTURE_TIPS[kind];
  const current = tips[tip % tips.length];

  // Rotate the directions while the user frames the shot.
  useEffect(() => {
    const id = setInterval(() => setTip((t) => t + 1), TIP_MS);
    return () => clearInterval(id);
  }, []);

  // Back button, swipe or close: hand back whatever was taken in Multiple mode, else nothing.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        if (finished.current) return;
        finished.current = true;
        finishCapture(null);
      }),
    [navigation],
  );

  function finish(uris: string[] | null) {
    if (finished.current) return;
    finished.current = true;
    finishCapture(uris);
    router.back();
  }

  function add(uris: string[]) {
    const next = [...shots, ...uris].slice(0, MAX_PHOTOS);
    if (mode === 'single' || next.length >= MAX_PHOTOS) return finish(next);
    setShots(next);
  }

  async function shoot() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) add([photo.uri]);
    } finally {
      setBusy(false);
    }
  }

  async function gallery() {
    const uris = await pickFromGallery(mode === 'multiple' ? MAX_PHOTOS - shots.length : 1);
    if (uris) add(uris);
  }

  function pickKind(k: 'meat' | 'fish') {
    setKind(k);
    setTip(0);
  }

  const screen = <Stack.Screen options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />;

  if (!permission) return <View style={styles.black}>{screen}</View>;

  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.center, { padding: Spacing.four }]}>
        {screen}
        <StatusBar style="light" />
        <Ionicons name="camera-outline" size={40} color={WHITE} />
        <ThemedText type="section" style={styles.white}>
          Camera access needed
        </ThemedText>
        <ThemedText type="small" style={[styles.white, { textAlign: 'center', opacity: 0.8 }]}>
          The camera checks freshness on your phone. Photos never leave it.
        </ThemedText>
        <Button
          title={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
        />
        <Button title="Upload from gallery instead" variant="secondary" onPress={gallery} />
        <Pressable onPress={() => finish(null)} style={{ padding: Spacing.two }}>
          <ThemedText type="label" style={styles.white}>
            Cancel
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.black}>
      {screen}
      <StatusBar style="light" />
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" flash={flash} enableTorch={torch} />

      {/* Top bar: close, on-device chip, flash */}
      <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]}>
        <RoundButton icon="close" label="Close camera" onPress={() => finish(null)} />
        <View style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: theme.fresh }]} />
          <ThemedText type="caption" style={styles.white}>
            On-device AI
          </ThemedText>
        </View>
        <RoundButton
          icon={flash === 'on' ? 'flash' : 'flash-off'}
          label={flash === 'on' ? 'Flash on' : 'Flash off'}
          onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))}
        />
      </View>

      {/* What are you scanning? Changes the directions. */}
      <View style={[styles.kinds, { top: insets.top + 64 }]}>
        {(['meat', 'fish'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => pickKind(k)}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === k }}
            style={[styles.kind, kind === k && { backgroundColor: WHITE }]}>
            <ThemedText type="label" style={{ color: kind === k ? '#111' : WHITE }}>
              {k === 'meat' ? 'Meat' : 'Fish'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {/* Framing guide */}
      <View pointerEvents="none" style={styles.frameWrap}>
        {kind === 'fish' && (
          <View style={styles.frameLabel}>
            <Ionicons name="eye-outline" size={13} color={WHITE} />
            <ThemedText type="caption" style={styles.white}>
              Eye and gills inside the frame
            </ThemedText>
          </View>
        )}
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
      </View>

      {/* Directions + steadiness */}
      <View pointerEvents="none" style={styles.hints}>
        {steady !== null && (
          <View style={[styles.hint, { backgroundColor: steady ? 'rgba(46,160,90,0.85)' : 'rgba(214,140,20,0.9)' }]}>
            <Ionicons name={steady ? 'checkmark-circle' : 'hand-left-outline'} size={14} color={WHITE} />
            <ThemedText type="caption" style={styles.white}>
              {steady ? 'Steady, ready to shoot' : 'Hold steady…'}
            </ThemedText>
          </View>
        )}
        <View style={styles.hint}>
          <Ionicons name={current.icon} size={14} color={WHITE} />
          <ThemedText type="caption" style={styles.white}>
            {current.text}
          </ThemedText>
        </View>
      </View>

      {/* Bottom: mode, gallery, shutter, torch */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]}>
        {allowMultiple && (
          <View style={styles.modes}>
            {(['single', 'multiple'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} hitSlop={8} accessibilityRole="radio" accessibilityState={{ selected: mode === m }}>
                <ThemedText type="label" style={{ color: mode === m ? theme.tint : WHITE, letterSpacing: 1 }}>
                  {m.toUpperCase()}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}
        {mode === 'multiple' && (
          <View style={styles.multiRow}>
            <ThemedText type="caption" style={[styles.white, { opacity: 0.8 }]}>
              {shots.length ? `${shots.length} of ${MAX_PHOTOS} · one item per photo` : `Up to ${MAX_PHOTOS} photos, one item each`}
            </ThemedText>
            {shots.length > 0 && (
              <Pressable onPress={() => finish(shots)} style={[styles.done, { backgroundColor: theme.tint }]}>
                <ThemedText type="label" style={styles.white}>
                  Check {shots.length}
                </ThemedText>
                <Ionicons name="arrow-forward" size={14} color={WHITE} />
              </Pressable>
            )}
          </View>
        )}
        <View style={styles.controls}>
          <Pressable onPress={gallery} accessibilityLabel="Pick from gallery" style={styles.thumb}>
            {shots.length > 0 ? (
              <>
                <Image source={{ uri: shots[shots.length - 1] }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={[styles.count, { backgroundColor: theme.tint }]}>
                  <ThemedText type="caption" style={styles.white}>
                    {shots.length}
                  </ThemedText>
                </View>
              </>
            ) : (
              <Ionicons name="images-outline" size={22} color={WHITE} />
            )}
          </Pressable>
          <Pressable onPress={shoot} disabled={busy} accessibilityRole="button" accessibilityLabel="Take photo" style={styles.shutter}>
            <View style={[styles.shutterInner, { backgroundColor: theme.tint, opacity: busy ? 0.6 : 1 }]}>
              {busy && <ActivityIndicator color={WHITE} />}
            </View>
          </Pressable>
          <RoundButton icon={torch ? 'bulb' : 'bulb-outline'} label={torch ? 'Light on' : 'Light off'} onPress={() => setTorch((t) => !t)} />
        </View>
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={styles.round}>
      <Ionicons name={icon} size={20} color={WHITE} />
    </Pressable>
  );
}

const CORNER = 28;
const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  white: { color: WHITE },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three },
  round: { width: 42, height: 42, borderRadius: 21, backgroundColor: DIM, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DIM, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  kinds: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', backgroundColor: DIM, borderRadius: 999, padding: 3 },
  kind: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 999 },
  frameWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  frameLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: DIM, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  frame: { width: '72%', aspectRatio: 1 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: WHITE },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  hints: { position: 'absolute', left: 0, right: 0, bottom: 230, alignItems: 'center', gap: Spacing.two },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DIM, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', paddingTop: Spacing.three, gap: Spacing.three },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.four },
  multiRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, minHeight: 32 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four + 8 },
  thumb: { width: 48, height: 48, borderRadius: 10, borderWidth: 2, borderColor: WHITE, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', right: 2, top: 2, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: WHITE, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
