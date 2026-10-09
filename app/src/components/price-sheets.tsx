import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Pill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { Sheet } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { REFERENCE_DATE } from '@/domain/palengke';
import {
  changeLabel,
  NOTABLE_CHANGE,
  peso,
  PRICE_AS_OF,
  PRICE_SOURCE,
  priceInfo,
  priceMonth,
} from '@/domain/prices';
import type { Line, RecipeView, swapFor } from '@/domain/recipes';
import { useTheme } from '@/hooks/use-theme';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Display names for the 6 proteins (Filipino name + English). */
export const ITEM_NAME: Record<string, string> = {
  bangus: 'Bangus (milkfish)',
  galunggong: 'Galunggong (round scad)',
  tilapia: 'Tilapia',
  pork: 'Pork',
  chicken: 'Chicken',
  beef: 'Beef',
};
export const itemName = (item: string) => ITEM_NAME[item] ?? capitalize(item);

/** ↑ +14% / ↓ −5% pill; null when the move is too small to call out (UC-4.2). */
export function ChangePill({ change }: { change: number | null }) {
  if (change == null || Math.abs(change) < NOTABLE_CHANGE) return null;
  const up = change > 0;
  return <Pill label={`${up ? '↑' : '↓'} ${changeLabel(change)}`} tone={up ? { fg: 'danger', bg: 'dangerSoft' } : { fg: 'fresh', bg: 'freshSoft' }} />;
}

// --- E01 / E05: price breakdown ----------------------------------------------

/** E01 price breakdown (UC-4.1) with E05's partial estimate (UC-4.5). */
export function BreakdownSheet({ view, onClose }: { view: RecipeView; onClose: () => void }) {
  const toBuy = view.lines.filter((l) => l.have !== 'all');
  const have = view.lines.filter((l) => l.have !== 'none');
  const pantryValue = view.cost - view.toBuy;
  return (
    <Sheet visible onClose={onClose}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <ThemedText type="section">Price breakdown</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {view.title} · {view.servingsShown} servings
          </ThemedText>
        </View>
        <Pill label={`${priceMonth()} prices`} tone={{ fg: 'tintText', bg: 'highlight' }} />
      </View>

      {toBuy.length > 0 && <Group title="To buy" lines={toBuy} amount={(l) => l.toBuy} />}
      {have.length > 0 && <Group title="Already in your pantry" lines={have} amount={(l) => (l.cost ?? 0) - l.toBuy} muted />}

      <Card tone="highlight" style={{ gap: Spacing.one }}>
        <Total label="To buy" value={peso(view.toBuy)} />
        <Total label="Pantry value used" value={peso(pantryValue)} />
        <View style={[styles.between, { marginTop: Spacing.one }]}>
          <ThemedText type="smallBold">Estimated total</ThemedText>
          <ThemedText type="section" themeColor="tintText">
            ≈ {peso(view.cost)}
            {view.unpriced > 0 ? '+' : ''}
          </ThemedText>
        </View>
        {view.unpriced > 0 && (
          <View style={styles.inline}>
            <Pill label="Partial estimate" tone={{ fg: 'tintText', bg: 'backgroundElement' }} />
            <ThemedText type="caption" themeColor="textSecondary">
              Leaves out {view.unpriced} item{view.unpriced === 1 ? '' : 's'}
            </ThemedText>
          </View>
        )}
      </Card>
      <ThemedText type="caption" themeColor="textSecondary">
        Uses the midpoint of each item&apos;s usual range · {PRICE_SOURCE}, as of {REFERENCE_DATE}.
        {view.unpriced > 0 ? " Items marked No price data aren't in this month's list yet, so the total doesn't include them." : ''}
      </ThemedText>
      <Button title="Done" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

function Group({ title, lines, amount, muted }: { title: string; lines: Line[]; amount: (l: Line) => number; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one + 2 }}>
      <ThemedText type="caption" themeColor="textSecondary">
        {title.toUpperCase()}
      </ThemedText>
      <Card tone={muted ? 'background' : undefined} style={{ gap: 0, paddingVertical: Spacing.one, borderColor: theme.backgroundSelected }}>
        {lines.map((l, i) => (
          <View key={l.item} style={[styles.lineRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{l.name}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {[l.amount, l.unitPrice].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
            {l.cost == null ? (
              <Pill label="No price data" tone={{ fg: 'textSecondary', bg: 'backgroundSelected' }} />
            ) : (
              <ThemedText type="smallBold">{peso(amount(l))}</ThemedText>
            )}
          </View>
        ))}
      </Card>
    </View>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.between}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

// --- E02: why it's pricey ------------------------------------------------------

/** Month initials for the 12 months ending at the price table's month. */
function monthLabels(n: number) {
  const [y, m] = PRICE_AS_OF.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(y, m - 1 - (n - 1 - i), 1));
}

/** 12-month history as single-series bars, the latest month highlighted (E02). */
function HistoryBars({ history, unit }: { history: number[]; unit: string }) {
  const theme = useTheme();
  const months = monthLabels(history.length);
  const [active, setActive] = useState(history.length - 1);
  const max = Math.max(...history);
  const min = Math.min(...history);
  // Bars start a little below the lowest month so differences are visible; the axis note says so.
  const floor = Math.max(0, min - (max - min) * 0.6 - 1);
  const h = (v: number) => 12 + ((v - floor) / (max - floor || 1)) * 88;
  const shown = months[active];
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="caption" themeColor="textSecondary">
        {shown.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}: {peso(history[active])}/{unit}
      </ThemedText>
      <View style={[styles.plot, { borderBottomColor: theme.backgroundSelected }]}>
        {history.map((v, i) => {
          const last = i === history.length - 1;
          const color: ThemeColor = last ? 'tint' : 'summaryBubble';
          return (
            <Pressable
              key={i}
              onPress={() => setActive(i)}
              accessibilityLabel={`${months[i].toLocaleDateString('en-US', { month: 'long' })}: ${peso(v)} per ${unit}`}
              style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  { height: h(v), backgroundColor: theme[color] },
                  active === i && !last && { backgroundColor: theme.tintText },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.monthRow}>
        {months.map((d, i) => (
          <ThemedText key={i} type="caption" themeColor={i === months.length - 1 ? 'tintText' : 'textSecondary'} style={styles.monthLabel}>
            {d.toLocaleDateString('en-US', { month: 'narrow' })}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

/** E02 why it's pricey (UC-4.2): this month vs the 12-month average, history and reason tag. */
export function WhySheet({ item, onClose }: { item: string; onClose: () => void }) {
  const info = priceInfo(item);
  if (!info) return null;
  const up = info.change >= NOTABLE_CHANGE;
  const down = info.change <= -NOTABLE_CHANGE;
  return (
    <Sheet visible onClose={onClose}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <ThemedText type="section">{itemName(item)}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            per {info.unit} · NCR
          </ThemedText>
        </View>
        {up && <Pill label="↑ Pricier" tone={{ fg: 'danger', bg: 'dangerSoft' }} />}
        {down && <Pill label="↓ Cheaper" tone={{ fg: 'fresh', bg: 'freshSoft' }} />}
      </View>
      <View style={styles.tiles}>
        <Card tone="background" style={styles.tile}>
          <ThemedText type="caption" themeColor="textSecondary">
            This month
          </ThemedText>
          <ThemedText type="smallBold">
            ₱{info.low}–₱{info.high}
          </ThemedText>
        </Card>
        <Card tone="background" style={styles.tile}>
          <ThemedText type="caption" themeColor="textSecondary">
            vs 12-month avg
          </ThemedText>
          <ThemedText type="smallBold" themeColor={up ? 'danger' : down ? 'fresh' : 'text'}>
            {changeLabel(info.change)}
          </ThemedText>
        </Card>
      </View>
      {info.history && info.history.length > 1 && (
        <Card style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">Average price per {info.unit}, last {info.history.length} months</ThemedText>
          <HistoryBars history={info.history} unit={info.unit} />
          <ThemedText type="caption" themeColor="textSecondary">
            Bars start above ₱0 to show the change · {info.source ?? PRICE_SOURCE}
          </ThemedText>
        </Card>
      )}
      {info.reason ? (
        <Note icon="information-circle-outline" tone="amber">
          <ThemedText type="smallBold">Why: {info.reason_title?.toLowerCase() ?? 'price change'}</ThemedText>
          <ThemedText type="caption">{info.reason}</ThemedText>
        </Note>
      ) : up ? (
        <Note icon="help-circle-outline" tone="neutral">
          No reason tag yet. The team adds these from DA and news reports.
        </Note>
      ) : null}
      <ThemedText type="caption" themeColor="textSecondary">
        Reason tags are curated by the team from DA and news reports, not generated by the AI.
      </ThemedText>
      <Button title="Done" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

// --- E03: cheaper swap ---------------------------------------------------------

type Swap = NonNullable<ReturnType<typeof swapFor>>;

/** E03 cheaper swap (UC-4.3). */
export function SwapSheet({ swap, fits, onClose }: { swap: Swap; fits: string | null; onClose: () => void }) {
  const theme = useTheme();
  const checks = [
    swap.toMainInPantry ? `${itemName(swap.to.ingredients[0].item)} is in your pantry` : null,
    fits ? `Still fits your profile: ${fits}` : null,
    swap.shared.length > 0 ? `Uses the same ${swap.shared.slice(0, 3).join(', ')}` : null,
  ].filter(Boolean) as string[];
  return (
    <Sheet visible onClose={onClose}>
      <View style={styles.inline}>
        <View style={[styles.swapIcon, { backgroundColor: theme.freshSoft }]}>
          <Ionicons name="swap-horizontal" size={18} color={theme.fresh} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText type="section">Save about {peso(swap.saves)}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {itemName(swap.main)} is pricier than usual this month
          </ThemedText>
        </View>
      </View>
      <View style={styles.tiles}>
        <Card style={styles.tile}>
          <ThemedText type="caption" themeColor="textSecondary">
            ORIGINAL
          </ThemedText>
          <ThemedText type="smallBold">{swap.from.title}</ThemedText>
          <ThemedText type="section">≈ {peso(swap.from.cost)}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {itemName(swap.main)} up {changeLabel(swap.change)} this month
          </ThemedText>
        </Card>
        <Card style={[styles.tile, { borderColor: theme.tint, borderWidth: 1.5, backgroundColor: theme.highlight }]}>
          <ThemedText type="caption" themeColor="tintText">
            SUGGESTED
          </ThemedText>
          <ThemedText type="smallBold">{swap.to.title}</ThemedText>
          <ThemedText type="section" themeColor="tintText">
            ≈ {peso(swap.to.cost)}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {swap.to.minutes} min
          </ThemedText>
        </Card>
      </View>
      {checks.length > 0 && (
        <Card tone="background" style={{ gap: Spacing.one + 2, borderColor: theme.backgroundSelected }}>
          {checks.map((c) => (
            <View key={c} style={styles.inline}>
              <Ionicons name="checkmark" size={14} color={theme.fresh} />
              <ThemedText type="caption">{c}</ThemedText>
            </View>
          ))}
        </Card>
      )}
      <Button
        title={`See ${swap.to.title}`}
        onPress={() => {
          onClose();
          router.replace({ pathname: '/recipes/[id]', params: { id: swap.to.id, servings: String(swap.to.servingsShown) } });
        }}
      />
      <Pressable onPress={onClose} style={styles.textButton}>
        <ThemedText type="label" themeColor="tintText">
          Keep {swap.from.title}
        </ThemedText>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tile: { flex: 1, gap: 2 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', height: 104, borderBottomWidth: 1 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '62%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  monthRow: { flexDirection: 'row' },
  monthLabel: { flex: 1, textAlign: 'center' },
  swapIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
