import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Budget } from '@/domain/budget';
import { peso } from '@/domain/prices';
import { useTheme } from '@/hooks/use-theme';

/**
 * This week's budget as a bar: spent (gray), what this would add (orange),
 * what's left (track). Used by N03, N04 and N05 (UC-9.1).
 */
export function BudgetBar({ budget, adding, label = "This week's budget" }: { budget: Budget; adding: number; label?: string }) {
  const theme = useTheme();
  const share = (v: number) => `${Math.min(100, Math.max(0, (v / budget.weekly) * 100))}%` as const;
  const after = budget.left - adding;
  const over = after < 0;
  return (
    <View style={{ gap: Spacing.one + 2 }}>
      <View style={styles.between}>
        <ThemedText type="caption" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="label">
          {peso(budget.left)} of {peso(budget.weekly)} left
        </ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.fill, { width: share(budget.spent), backgroundColor: theme.textSecondary }]} />
        <View style={[styles.fill, { width: share(Math.min(adding, budget.left)), backgroundColor: over ? theme.danger : theme.tint }]} />
      </View>
      {adding > 0 && (
        <ThemedText type="caption" themeColor={over ? 'danger' : 'fresh'}>
          {over
            ? `Adding ${peso(adding)} goes ${peso(-after)} over this week's budget`
            : `Adding ${peso(adding)} leaves ${peso(after)} for the week`}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  track: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  fill: { height: 6 },
});
