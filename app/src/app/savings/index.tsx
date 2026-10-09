import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { ThemedText } from '@/components/themed-text';
import { WeeklyBars } from '@/components/weekly-bars';
import { Fonts, Spacing } from '@/constants/theme';
import { listFinished, monthRange } from '@/db/savings';
import { peso } from '@/domain/prices';
import { summarizeMonth } from '@/domain/savings';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';

/** N01 Savings overview (UC-8.1). Totals come from pantry items marked Used or Wasted. */
export default function SavingsScreen() {
  const theme = useTheme();
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);
  const load = useCallback((db: SQLiteDatabase) => listFinished(db, range.start, range.end), [range.start, range.end]);
  const [items] = useFocusQuery(load, null as Awaited<ReturnType<typeof listFinished>> | null);
  const month = range.date.toLocaleDateString('en-US', { month: 'long' });

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <ThemedText type="section" style={{ flex: 1 }}>
          Savings
        </ThemedText>
        <View style={[styles.monthPicker, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Pressable onPress={() => setOffset(offset - 1)} accessibilityLabel="Previous month" hitSlop={8}>
            <Ionicons name="chevron-back" size={14} color={theme.text} />
          </Pressable>
          <ThemedText type="label">{month}</ThemedText>
          <Pressable onPress={() => setOffset(Math.min(0, offset + 1))} disabled={offset === 0} accessibilityLabel="Next month" hitSlop={8}>
            <Ionicons name="chevron-forward" size={14} color={offset === 0 ? theme.backgroundSelected : theme.text} />
          </Pressable>
        </View>
      </View>

      {items && <Overview items={items} month={month} />}
    </SafeAreaView>
  );
}

function Overview({ items, month }: { items: Awaited<ReturnType<typeof listFinished>>; month: string }) {
  const theme = useTheme();
  const s = summarizeMonth(items);

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: theme.freshSoft }]}>
          <Ionicons name="leaf-outline" size={28} color={theme.fresh} />
        </View>
        <ThemedText type="section">Nothing tracked in {month} yet</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          When you mark pantry items Used or Wasted, the pesos you saved show up here.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card tone="freshSoft" style={styles.hero}>
        <ThemedText type="caption" themeColor="fresh">
          Food you used before it spoiled
        </ThemedText>
        <ThemedText type="title" themeColor="fresh" style={styles.heroNumber}>
          {peso(s.saved)}
        </ThemedText>
        <ThemedText type="small">
          {s.meals >= 1 ? `That's about ${s.meals} family meal${s.meals === 1 ? '' : 's'} this month.` : 'Every item you use counts.'}
        </ThemedText>
      </Card>

      <View style={styles.tiles}>
        <Card style={styles.tile}>
          <View style={[styles.tileIcon, { backgroundColor: theme.freshSoft }]}>
            <Ionicons name="scale-outline" size={14} color={theme.fresh} />
          </View>
          <ThemedText type="title" style={styles.tileNumber}>
            {s.kgRescued.toFixed(1)} kg
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            food rescued
          </ThemedText>
        </Card>
        <Card style={styles.tile}>
          <View style={[styles.tileIcon, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="trash-outline" size={14} color={theme.danger} />
          </View>
          <ThemedText type="title" style={styles.tileNumber}>
            {peso(s.wasted)}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            wasted ({s.wastedCount} item{s.wastedCount === 1 ? '' : 's'})
          </ThemedText>
        </Card>
      </View>

      <Card>
        <WeeklyBars weeks={s.weeks} />
      </Card>

      <Note icon="bulb-outline" tone="neutral">
        {s.tip}
      </Note>

      <Pressable onPress={() => router.push('/savings/log')} accessibilityRole="button">
        <Card style={styles.logRow}>
          <Ionicons name="list-outline" size={16} color={theme.text} />
          <ThemedText type="small" style={{ flex: 1 }}>
            Item log · {items.length} item{items.length === 1 ? '' : 's'}
          </ThemedText>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </Card>
      </Pressable>

      <ThemedText type="caption" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Values use the price you paid in Palengke Mode, or this month&apos;s usual price.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  monthPicker: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  content: { padding: Spacing.three + 4, gap: Spacing.three },
  hero: { padding: Spacing.four - 4, gap: Spacing.one },
  heroNumber: { fontFamily: Fonts.extraBold, fontSize: 36, lineHeight: 42 },
  tiles: { flexDirection: 'row', gap: Spacing.three - 4 },
  tile: { flex: 1, gap: 2 },
  tileIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  tileNumber: { fontSize: 22, lineHeight: 28 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
