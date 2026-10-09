import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Segmented, Sheet } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import type { PalengkeCheck } from '@/db/palengke';
import { getPantryItem, recompute, updatePantryItem } from '@/db/pantry';
import { daysUntil, longCountdown } from '@/domain/cook-by';
import { unitShort, type Reference, type VerdictKind } from '@/domain/palengke';
import type { Storage } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

/** Usual range as a green band with the vendor's price marked (M02, M04–M07). */
export function PriceBar({ range, price, color = 'fresh' }: { range: Reference; price?: number; color?: ThemeColor }) {
  const theme = useTheme();
  const span = range.high - range.low || range.high * 0.2;
  const min = range.low - span;
  const max = range.high + span;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%` as const;
  return (
    <View style={styles.barWrap}>
      {price != null && (
        <View style={[styles.markerLabel, { left: pos(price), backgroundColor: theme[color] }]}>
          <ThemedText type="caption" style={{ color: '#fff' }}>
            ₱{price}
          </ThemedText>
        </View>
      )}
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.band, { left: pos(range.low), width: `${(span / (max - min)) * 100}%`, backgroundColor: theme.fresh }]} />
        {price != null && <View style={[styles.marker, { left: pos(price), backgroundColor: theme[color], borderColor: theme.backgroundElement }]} />}
      </View>
      <View style={styles.ticks}>
        <ThemedText type="caption" themeColor="textSecondary" style={{ position: 'absolute', left: pos(range.low), transform: [{ translateX: -12 }] }}>
          ₱{range.low}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" style={{ position: 'absolute', left: pos(range.high), transform: [{ translateX: -12 }] }}>
          ₱{range.high}
        </ThemedText>
      </View>
    </View>
  );
}

const VERDICT_STYLE: Record<VerdictKind, { icon: keyof typeof Ionicons.glyphMap; fg: ThemeColor; bg: ThemeColor }> = {
  good_buy: { icon: 'checkmark', fg: 'fresh', bg: 'freshSoft' },
  haggle: { icon: 'pricetag', fg: 'amber', bg: 'amberSoft' },
  cook_today: { icon: 'restaurant', fg: 'amber', bg: 'amberSoft' },
  skip: { icon: 'close', fg: 'danger', bg: 'dangerSoft' },
  dont_buy: { icon: 'close', fg: 'danger', bg: 'dangerSoft' },
  no_reference: { icon: 'scale-outline', fg: 'textSecondary', bg: 'backgroundSelected' },
};

export function verdictColor(kind: VerdictKind): ThemeColor {
  return VERDICT_STYLE[kind].fg;
}

/** Big verdict banner at the top of a check (M04–M08, M11–M12). */
export function VerdictCard({ kind, title, body }: { kind: VerdictKind | 'trade_off'; title: string; body: string }) {
  const theme = useTheme();
  const s = kind === 'trade_off' ? { icon: 'scale-outline' as const, fg: 'amber' as ThemeColor, bg: 'amberSoft' as ThemeColor } : VERDICT_STYLE[kind];
  return (
    <View style={[styles.verdict, { backgroundColor: theme[s.bg] }]}>
      <View style={[styles.verdictIcon, { backgroundColor: theme[s.fg] }]}>
        <Ionicons name={s.icon} size={22} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="section" themeColor={s.fg === 'textSecondary' ? 'text' : s.fg === 'amber' ? 'tintText' : s.fg}>
          {title}
        </ThemedText>
        <ThemedText type="caption">{body}</ThemedText>
      </View>
    </View>
  );
}

/** Header used on every Palengke check screen. */
export function PalengkeHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        accessibilityLabel="Back"
        hitSlop={8}
        style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
        <Ionicons name="chevron-back" size={18} color={theme.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <ThemedText type="section" style={{ fontSize: 16 }}>
          {title}
        </ThemedText>
        {subtitle && (
          <ThemedText type="caption" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        )}
      </View>
      <View style={[styles.offline, { backgroundColor: theme.freshSoft }]}>
        <View style={[styles.dot, { backgroundColor: theme.fresh }]} />
        <ThemedText type="caption" themeColor="fresh">
          Offline OK
        </ThemedText>
      </View>
    </View>
  );
}

/** M09: added to pantry with the price paid; storage can still be changed. */
export function BoughtSheet({
  check,
  pantryId,
  daysLeft,
  onScanAnother,
}: {
  check: PalengkeCheck;
  pantryId: string;
  daysLeft: number;
  onScanAnother: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [storage, setStorage] = useState<Storage>('ref');
  const [left, setLeft] = useState(daysLeft);

  async function changeStorage(s: Storage) {
    setStorage(s);
    const item = await getPantryItem(db, pantryId);
    if (!item) return;
    const patch = recompute(item, { storage: s });
    await updatePantryItem(db, pantryId, patch);
    setLeft(daysUntil(patch.cook_by!));
  }

  const unit = unitShort(check.unit);
  return (
    <Sheet visible onClose={() => router.back()}>
      <View style={styles.boughtTitle}>
        <View style={[styles.verdictIcon, { backgroundColor: theme.freshSoft }]}>
          <Ionicons name="checkmark" size={20} color={theme.fresh} />
        </View>
        <View>
          <ThemedText type="section">Added to your pantry</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={{ textTransform: 'capitalize' }}>
            {check.item} · 1 {unit}
          </ThemedText>
        </View>
      </View>
      <Card tone="background" style={{ gap: 0, paddingVertical: Spacing.one, borderColor: theme.backgroundSelected }}>
        <Row icon="time-outline" label="Bought" value="Today" />
        <Row icon="card-outline" label="Paid" value={`₱${check.price}/${unit} · ₱${check.price} total`} divider />
        <Row icon="restaurant-outline" label="Cook within" value={longCountdown(left)} divider />
      </Card>
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="label">Where will you keep it?</ThemedText>
        <Segmented
          value={storage}
          onChange={changeStorage}
          options={[
            { value: 'ref', label: 'Ref' },
            { value: 'freezer', label: 'Freezer' },
            { value: 'counter', label: 'Counter' },
          ]}
        />
        <ThemedText type="caption" themeColor="textSecondary">
          The price you paid is used in your Savings tracker.
        </ThemedText>
      </View>
      <Button title="Scan another item" icon="scan" onPress={onScanAnother} />
      <Pressable onPress={() => router.dismissTo('/pantry')} style={styles.textButton}>
        <ThemedText type="label" themeColor="tintText">
          View pantry
        </ThemedText>
      </Pressable>
    </Sheet>
  );
}

function Row({ icon, label, value, divider }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; divider?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={14} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  barWrap: { paddingTop: 24, paddingBottom: 18 },
  track: { height: 6, borderRadius: 3 },
  band: { position: 'absolute', height: 6, borderRadius: 3 },
  marker: { position: 'absolute', top: -4, width: 14, height: 14, borderRadius: 7, borderWidth: 2, transform: [{ translateX: -7 }] },
  markerLabel: { position: 'absolute', top: 0, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, transform: [{ translateX: -20 }] },
  ticks: { height: 16, marginTop: 4 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, borderRadius: 16, padding: Spacing.three },
  verdictIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  boughtTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2 },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
