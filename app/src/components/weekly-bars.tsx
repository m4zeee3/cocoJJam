import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { peso } from '@/domain/prices';
import { useTheme } from '@/hooks/use-theme';

type Week = { label: string; saved: number; wasted: number };

const PLOT_HEIGHT = 110;

/**
 * Saved vs wasted per week (N01). Two series → legend; tap a week to read its
 * values. Wasted uses the orange-text token, not red: green vs red fails
 * deuteranopia (ΔE 1.8), green vs #C2410C passes every check.
 */
export function WeeklyBars({ weeks }: { weeks: Week[] }) {
  const theme = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.flatMap((w) => [w.saved, w.wasted]));
  const colors = { saved: theme.fresh, wasted: theme.tintText };
  const h = (v: number) => (v > 0 ? Math.max(3, (v / max) * PLOT_HEIGHT) : 0);
  const shown = active != null ? weeks[active] : null;

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">By week</ThemedText>
        <View style={styles.legend}>
          <LegendItem color={colors.saved} label="Saved" />
          <LegendItem color={colors.wasted} label="Wasted" />
        </View>
      </View>

      <ThemedText type="caption" themeColor="textSecondary" style={{ minHeight: 16 }}>
        {shown ? `${shown.label}: ${peso(shown.saved)} saved · ${peso(shown.wasted)} wasted` : 'Tap a week to see the amounts'}
      </ThemedText>

      <View style={[styles.plot, { borderBottomColor: theme.backgroundSelected }]}>
        {weeks.map((w, i) => (
          <Pressable
            key={w.label}
            onPress={() => setActive(active === i ? null : i)}
            accessibilityRole="button"
            accessibilityLabel={`${w.label}: ${peso(w.saved)} saved, ${peso(w.wasted)} wasted`}
            style={[styles.column, active === i && { backgroundColor: theme.background }]}>
            <View style={styles.pair}>
              <View style={[styles.bar, { height: h(w.saved), backgroundColor: colors.saved, opacity: active == null || active === i ? 1 : 0.45 }]} />
              <View style={[styles.bar, { height: h(w.wasted), backgroundColor: colors.wasted, opacity: active == null || active === i ? 1 : 0.45 }]} />
            </View>
          </Pressable>
        ))}
      </View>
      <View style={styles.labels}>
        {weeks.map((w) => (
          <ThemedText key={w.label} type="caption" themeColor="textSecondary" style={styles.label}>
            {w.label}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', gap: Spacing.three - 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  plot: { flexDirection: 'row', height: PLOT_HEIGHT + 8, borderBottomWidth: 1, alignItems: 'flex-end' },
  column: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  pair: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 14, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: 'row' },
  label: { flex: 1, textAlign: 'center' },
});
