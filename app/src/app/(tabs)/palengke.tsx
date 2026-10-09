import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Pill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ItemIcon } from '@/components/item-icon';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { listTodayChecks, type PalengkeCheck } from '@/db/palengke';
import { REFERENCE_DATE, unitShort, VERDICT_LABEL, type VerdictKind } from '@/domain/palengke';
import { PRICE_SOURCE } from '@/domain/prices';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { pickPhoto } from '@/lib/open-scanner';

const TONE: Record<VerdictKind, { fg: ThemeColor; bg: ThemeColor }> = {
  good_buy: { fg: 'fresh', bg: 'freshSoft' },
  haggle: { fg: 'amber', bg: 'amberSoft' },
  cook_today: { fg: 'amber', bg: 'amberSoft' },
  skip: { fg: 'danger', bg: 'dangerSoft' },
  dont_buy: { fg: 'danger', bg: 'dangerSoft' },
  no_reference: { fg: 'textSecondary', bg: 'backgroundSelected' },
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "bought", or "skipped" once the user passed on it: a skip/don't-buy verdict, or a newer
 * check came after it. The newest check with no decision yet shows neither.
 */
function outcome(c: PalengkeCheck, index: number) {
  if (c.bought) return 'bought';
  if (c.verdict === 'skip' || c.verdict === 'dont_buy' || index > 0) return 'skipped';
  return null;
}

/** M01 Palengke Mode home (Module 6): check freshness and price before you buy. Works offline. */
export default function PalengkeScreen() {
  const theme = useTheme();
  const [checks] = useFocusQuery<PalengkeCheck[]>(listTodayChecks, []);

  async function scan() {
    const photo = await pickPhoto();
    if (photo) router.push({ pathname: '/market/check', params: { photo } });
  }

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <ThemedText type="title">Palengke Mode</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Check freshness and price before you buy
        </ThemedText>
      </View>

      <Card tone="highlight" style={styles.hero}>
        <View style={styles.icons}>
          {['bangus', 'chicken', 'pork'].map((name) => (
            <View key={name} style={[styles.iconBubble, { backgroundColor: theme.backgroundElement }]}>
              <ItemIcon name={name} size={18} />
            </View>
          ))}
        </View>
        <ThemedText type="section">Scan before you buy</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Snap the item, enter the vendor&apos;s price, and get a fair or high verdict plus a freshness check. Works with
          no signal.
        </ThemedText>
        <Button title="Scan an item" icon="scan" onPress={scan} />
      </Card>

      <Pressable onPress={() => router.push('/prices')} accessibilityRole="button" style={styles.inline}>
        <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary" style={{ flex: 1 }}>
          Reference prices: {PRICE_SOURCE}, as of {REFERENCE_DATE}
        </ThemedText>
        <ThemedText type="label" themeColor="tintText">
          See all
        </ThemedText>
      </Pressable>

      {checks.length > 0 && (
        <View style={{ gap: Spacing.two }}>
          <View style={styles.between}>
            <ThemedText type="section">Today&apos;s checks</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {checks.length}
            </ThemedText>
          </View>
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {checks.map((c, i) => (
              <View key={c.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
                  {c.photo_uri ? (
                    <Image source={{ uri: c.photo_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <ItemIcon name={c.item} size={20} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">
                    {capitalize(c.item)}
                    {c.cut ? ` ${c.cut}` : ''}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {[`₱${c.price}/${unitShort(c.unit)}`, outcome(c, i)].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>
                <Pill label={VERDICT_LABEL[c.verdict]} tone={TONE[c.verdict]} />
              </View>
            ))}
          </Card>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: Spacing.four - 4, gap: Spacing.three - 4 },
  icons: { flexDirection: 'row', gap: Spacing.one },
  iconBubble: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  thumb: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
