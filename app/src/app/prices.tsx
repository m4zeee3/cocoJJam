import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/card';
import { ChoicePills } from '@/components/controls';
import { ItemIcon } from '@/components/item-icon';
import { ChangePill, itemName, WhySheet } from '@/components/price-sheets';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { REFERENCE_DATE } from '@/domain/palengke';
import { allPrices, changeLabel, NOTABLE_CHANGE, PRICE_ATTRIBUTION, PRICE_SOURCE, priceMonth, type Protein } from '@/domain/prices';
import { useTheme } from '@/hooks/use-theme';

const FILTERS: { value: 'all' | Protein; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fish', label: 'Fish' },
  { value: 'pork', label: 'Pork' },
  { value: 'chicken', label: 'Chicken' },
  { value: 'beef', label: 'Beef' },
];

/** E04 Market prices (UC-4.4): this month's reference prices, saved on the phone. */
export default function MarketPricesScreen() {
  const theme = useTheme();
  const [filter, setFilter] = useState<'all' | Protein>('all');
  const [why, setWhy] = useState<string | null>(null);
  const prices = allPrices().filter((p) => filter === 'all' || p.category === filter);
  const moving = prices.filter((p) => Math.abs(p.change) >= NOTABLE_CHANGE).sort((a, b) => b.change - a.change);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <View>
          <ThemedText type="section">Market prices</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {priceMonth('long')} · NCR · per kg
          </ThemedText>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card tone="backgroundSelected" style={styles.offline}>
          <Ionicons name="phone-portrait-outline" size={16} color={theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">Saved on this phone</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              Works offline. Prices as of {REFERENCE_DATE}, refreshed with each app update.
            </ThemedText>
          </View>
        </Card>

        <ChoicePills options={FILTERS} value={filter} onChange={setFilter} />

        {moving.length > 0 && (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="caption" themeColor="textSecondary">
              MOVING THIS MONTH
            </ThemedText>
            <View style={styles.movingRow}>
              {moving.slice(0, 2).map((p) => (
                <Pressable key={p.item} onPress={() => setWhy(p.item)} style={{ flex: 1 }} accessibilityRole="button">
                  <Card style={{ gap: Spacing.one }}>
                    <View style={styles.between}>
                      <ItemIcon name={p.item} size={20} />
                      <ChangePill change={p.change} />
                    </View>
                    <ThemedText type="smallBold">{itemName(p.item)}</ThemedText>
                    <ThemedText type="caption" themeColor={p.reason_title ? 'tintText' : 'textSecondary'}>
                      {p.reason_title ?? `${changeLabel(p.change)} vs 12-month avg`}
                    </ThemedText>
                  </Card>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={{ gap: Spacing.two }}>
          <ThemedText type="caption" themeColor="textSecondary">
            ALL ITEMS
          </ThemedText>
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {prices.map((p, i) => {
              const pct = Math.round(p.change * 100);
              return (
                <Pressable
                  key={p.item}
                  onPress={() => setWhy(p.item)}
                  accessibilityRole="button"
                  style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                  <View style={[styles.icon, { backgroundColor: theme.highlight }]}>
                    <ItemIcon name={p.item} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold">{itemName(p.item)}</ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      ₱{p.low}–₱{p.high} / {p.unit}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="label"
                    themeColor={Math.abs(p.change) < NOTABLE_CHANGE ? 'textSecondary' : pct > 0 ? 'danger' : 'fresh'}>
                    {pct > 0 ? '↑ ' : pct < 0 ? '↓ ' : '— '}
                    {changeLabel(p.change)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </Card>
          <ThemedText type="caption" themeColor="textSecondary">
            % compares this month with the 12-month average. Ranges are the monthly average ±7%. {PRICE_SOURCE}.
          </ThemedText>
        </View>

        <ThemedText type="caption" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {PRICE_ATTRIBUTION}
        </ThemedText>
      </ScrollView>

      {why && <WhySheet item={why} onClose={() => setWhy(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.three },
  offline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  movingRow: { flexDirection: 'row', gap: Spacing.two },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
