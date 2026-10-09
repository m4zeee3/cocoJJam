import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StagePill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { BoughtSheet, PalengkeHeader, VerdictCard } from '@/components/palengke';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { buyFromCheck, listTripChecks, type PalengkeCheck } from '@/db/palengke';
import { rankStalls, unitShort } from '@/domain/palengke';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { pickPhoto } from '@/lib/open-scanner';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** M11 best pick / M12 fresher vs cheaper (UC-6.7). */
export default function CompareStallsScreen() {
  const { item, cut } = useLocalSearchParams<{ item: string; cut?: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const load = useCallback((d: SQLiteDatabase) => listTripChecks(d, item, cut || null), [item, cut]);
  const [checks] = useFocusQuery<PalengkeCheck[] | null>(load, null);
  const [cookingTonight, setCookingTonight] = useState(false);
  const [bought, setBought] = useState<{ check: PalengkeCheck; pantryId: string; daysLeft: number } | null>(null);

  if (!checks) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;

  // Compare in one unit: the unit of the latest check.
  const unit = checks[checks.length - 1]?.unit ?? 'kg';
  const sameUnit = checks.filter((c) => c.unit === unit && !c.bought);
  const result = rankStalls(sameUnit);
  const byId = new Map(sameUnit.map((c) => [c.id, c]));
  const chosen = result.tradeOff && cookingTonight ? result.tradeOff : result.best;
  const pricier = result.best ? result.ranked.find((r) => r.price > result.best!.price) : undefined;

  async function buy() {
    if (!chosen) return;
    const check = byId.get(chosen.id)!;
    setBought({ check, ...(await buyFromCheck(db, check)) });
  }

  async function checkAnother() {
    const photo = await pickPhoto();
    if (photo) router.replace({ pathname: '/market/check', params: { photo } });
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <PalengkeHeader title="Compare stalls" subtitle={`${capitalize(item)} · ${sameUnit.length} stalls · this trip`} />
      <ScrollView contentContainerStyle={styles.content}>
        <VerdictCard kind={result.tradeOff ? 'trade_off' : result.best ? 'good_buy' : 'dont_buy'} title={result.title} body={result.body} />

        {result.ranked.map((s, i) => {
          const c = byId.get(s.id)!;
          const best = s.id === result.best?.id;
          const diff = result.best ? s.price - result.best.price : 0;
          return (
            <Card key={s.id} style={[styles.stall, best && { borderColor: theme.tint, borderWidth: 1.5, backgroundColor: theme.highlight }]}>
              <View style={[styles.rank, { backgroundColor: best ? theme.tint : theme.backgroundSelected }]}>
                <ThemedText type="label" style={best ? { color: '#fff' } : undefined}>
                  {i + 1}
                </ThemedText>
              </View>
              <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
                {c.photo_uri && <Image source={{ uri: c.photo_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.inline}>
                  <ThemedText type="smallBold">{s.stall}</ThemedText>
                  {best && (
                    <View style={[styles.bestTag, { backgroundColor: theme.tint }]}>
                      <ThemedText type="caption" style={{ color: '#fff' }}>
                        Best pick
                      </ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText type="caption" themeColor="textSecondary">
                  {time(s.created_at)}
                </ThemedText>
                <StagePill stage={s.stage} />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <ThemedText type="section" themeColor="tintText">
                  ₱{s.price}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  per {unitShort(s.unit)}
                </ThemedText>
                {diff !== 0 && (
                  <ThemedText type="caption" themeColor={diff > 0 ? 'textSecondary' : 'fresh'}>
                    {diff > 0 ? `+₱${diff}` : `−₱${-diff}`}
                  </ThemedText>
                )}
              </View>
            </Card>
          );
        })}

        {result.tradeOff && (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="smallBold">Are you cooking it tonight?</ThemedText>
            <Choice
              selected={!cookingTonight}
              onPress={() => setCookingTonight(false)}
              title="Not tonight"
              body={`Buy at ${result.best!.stall}, it keeps longer`}
            />
            <Choice
              selected={cookingTonight}
              onPress={() => setCookingTonight(true)}
              title="Yes, tonight"
              body={`${result.tradeOff.stall} is fine and saves ₱${result.best!.price - result.tradeOff.price}`}
            />
          </View>
        )}

        {!result.tradeOff && result.best && pricier && (
          <Note icon="chatbubble-outline" tone="neutral">
            {`Prefer ${pricier.stall}? It asked ₱${pricier.price}, but ${result.best.stall} sells at ₱${result.best.price}. You can mention that.`}
          </Note>
        )}
        <View style={styles.inline}>
          <Ionicons name="lock-closed-outline" size={12} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Freshness first, then price · compared on your phone
          </ThemedText>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {chosen && <Button title={`Bought at ${chosen.stall}`} icon="checkmark" onPress={buy} />}
        <Button title="Check another stall" icon="scan" variant="secondary" onPress={checkAnother} />
      </View>

      {bought && <BoughtSheet check={bought.check} pantryId={bought.pantryId} daysLeft={bought.daysLeft} onScanAnother={checkAnother} />}
    </SafeAreaView>
  );
}

function Choice({ selected, onPress, title, body }: { selected: boolean; onPress: () => void; title: string; body: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.choice, { borderColor: selected ? theme.tint : theme.backgroundSelected, backgroundColor: selected ? theme.highlight : theme.backgroundElement }]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? theme.tint : theme.textSecondary} />
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {body}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing.three + 4, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: Spacing.four },
  stall: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  rank: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  bestTag: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, borderWidth: 1, borderRadius: 14, padding: Spacing.three - 4 },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two, gap: Spacing.two },
});
