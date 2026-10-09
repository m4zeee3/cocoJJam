import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Bottom sheet over a dimmed backdrop (P04, P07, P08, P11). */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement, paddingBottom: Spacing.four + insets.bottom },
          ]}>
          <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Ref / Freezer / Counter style segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="label" themeColor={selected ? 'text' : 'textSecondary'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Single-select pills where the picked one is outlined in orange (Today / This week …). */
export function ChoicePills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.pills}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              styles.pill,
              {
                borderColor: selected ? theme.tint : theme.backgroundSelected,
                backgroundColor: selected ? theme.highlight : theme.backgroundElement,
              },
            ]}>
            <ThemedText type="label" themeColor={selected ? 'tintText' : 'text'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** − 2 + stepper. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const theme = useTheme();
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(round(Math.max(min, value - step)))}
        disabled={value <= min}
        accessibilityLabel="Less"
        style={[styles.stepButton, { backgroundColor: theme.backgroundSelected, opacity: value <= min ? 0.4 : 1 }]}>
        <Ionicons name="remove" size={16} color={theme.text} />
      </Pressable>
      <ThemedText type="smallBold" style={styles.stepValue}>
        {value}
      </ThemedText>
      <Pressable
        onPress={() => onChange(round(Math.min(max, value + step)))}
        disabled={value >= max}
        accessibilityLabel="More"
        style={[styles.stepButton, { backgroundColor: theme.highlight, opacity: value >= max ? 0.4 : 1 }]}>
        <Ionicons name="add" size={16} color={theme.tint} />
      </Pressable>
    </View>
  );
}

/** Dark toast with an optional action, auto-hides after a few seconds (P06). */
export function Toast({
  message,
  action,
  onAction,
  onHide,
}: {
  message: string | null;
  action?: string;
  onAction?: () => void;
  onHide: () => void;
}) {
  const theme = useTheme();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onHide, 4000);
    return () => clearTimeout(t);
  }, [message, onHide]);
  if (!message) return null;
  return (
    <View style={[styles.toast, { backgroundColor: theme.text }]}>
      <Ionicons name="checkmark-circle" size={20} color={theme.fresh} />
      <ThemedText type="small" style={styles.toastText}>
        {message}
      </ThemedText>
      {action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <ThemedText type="label" style={{ color: '#FDBA74' }}>
            {action}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(35,33,30,0.45)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.four - 4,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: Spacing.two },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two + 1, borderRadius: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: Spacing.two },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  stepButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 28, textAlign: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
  },
  toastText: { flex: 1, color: '#fff' },
});
