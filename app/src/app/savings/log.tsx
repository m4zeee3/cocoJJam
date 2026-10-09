import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/card';
import { Segmented } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { ItemIcon } from '@/components/item-icon';
import { Spacing } from '@/constants/theme';
import { listFinished, monthRange } from '@/db/savings';
import { pantryValue, peso } from '@/domain/prices';
import { weightKg } from '@/domain/savings';
import { UNIT_LABEL } from '@/domain/types';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';

type Item = Awaited<ReturnType<typeof listFinished>>[number];

const load = (db: SQLiteDatabase) => {
  const { start, end } = monthRange(0);
  return listFinished(db, start, end);
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "2 pcs (about 500 g)", "250 g", "1 kg": pieces get an estimated weight. */
function amountText(i: Item) {
  const unit = UNIT_LABEL[i.unit] ?? i.unit;
  const plural = i.unit === 'pc' && i.quantity !== 1 ? 'pcs' : unit;
  const base = `${i.quantity} ${plural}`;
  if (i.unit === 'g' || i.unit === 'kg') return base;
  const kg = weightKg(i);
  if (!kg) return base;
  const g = Math.round((kg * 1000) / 50) * 50;
  return `${base} (about ${g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${g} g`})`;
}

/** N02 item log: used vs wasted this month (UC-8.1), the table view behind the chart. */
export default function ItemLogScreen() {
  const theme = useTheme();
  const [items] = useFocusQuery<Item[]>(load, []);
  const [filter, setFilter] = useState<'all' | 'used' | 'wasted'>('all');
  const shown = filter === 'all' ? items : items.filter((i) => i.status === filter);
  const month = new Date().toLocaleDateString('en-US', { month: 'long' });
  // Values are the paid price when known (Palengke Mode, shopping list), else this month's midpoint.
  const prices = items.some((i) => i.paid_price_php != null) ? 'paid or midpoint prices' : 'midpoint prices';

  const days: { day: string; rows: Item[] }[] = [];
  for (const i of shown) {
    const day = new Date(i.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(i);
    else days.push({ day, rows: [i] });
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <View>
          <ThemedText type="section">Item log</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {month} so far · at {prices}
          </ThemedText>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'used', label: 'Used' },
            { value: 'wasted', label: 'Wasted' },
          ]}
        />
        {days.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', marginTop: Spacing.four }}>
            Nothing here yet.
          </ThemedText>
        )}
        {days.map((d) => (
          <View key={d.day} style={{ gap: Spacing.two }}>
            <ThemedText type="caption" themeColor="textSecondary">
              {d.day}
            </ThemedText>
            <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
              {d.rows.map((i, n) => {
                const used = i.status === 'used';
                return (
                  <View key={i.id} style={[styles.row, n > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                    <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
                      {i.thumbnail_uri ? (
                        <Image source={{ uri: i.thumbnail_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <ItemIcon name={i.name} size={16} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">{capitalize(i.name)}</ThemedText>
                      <ThemedText type="caption" themeColor={used ? 'fresh' : 'danger'}>
                        {[used ? 'Used' : 'Wasted', amountText(i), i.finish_note].filter(Boolean).join(' · ')}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold" themeColor={used ? 'fresh' : 'danger'}>
                      {peso(pantryValue(i))}
                    </ThemedText>
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  thumb: { width: 36, height: 36, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
