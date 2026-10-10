import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Dot } from '@/components/badges';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CookByEstimate } from '@/domain/cook-by';
import type { Purchase, Stage, Storage } from '@/domain/types';
import type { Tip } from '@/ml/messages';
import { useTheme } from '@/hooks/use-theme';

export type Scan = {
  photo: string;
  item: string;
  stage: Stage;
  typedIn: boolean;
  /** Shelf-life rules to use when the name isn't in the table (a typed-in fish uses "fish"). */
  rulesKey?: string;
  /** Fish: the view the model looked at. */
  view?: 'eye' | 'gill' | null;
  /** The stage is the user's own check (smell, color, texture), not the photo. */
  ownCheck?: boolean;
  storage?: Storage;
  purchase?: Purchase;
  estimate?: CookByEstimate;
};

/** One message in the scanner thread. Plain data, so the thread can be saved on the phone. */
export type Msg =
  /** Start of a scan: "Today 5:09 PM". */
  | { kind: 'divider'; at: number }
  | { kind: 'photos'; uris: string[] }
  /**
   * Dishes picked for the scanned item (R01), with a link to the full list. `mainId` = the
   * item's pantry row once saved, so a dish picked here is planned for it (UC-3.10).
   */
  | { kind: 'dishes'; item: string; mainId?: string; dishes: { id: string; title: string; minutes: number; cost: number }[] }
  | { kind: 'bot'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'photo'; uri: string }
  | { kind: 'tips'; title?: string; tips: Tip[] }
  /** Small grey line under a bot turn. */
  | { kind: 'footnote'; text: string }
  | { kind: 'identified'; scan: Scan }
  | { kind: 'result'; scan: Scan }
  | { kind: 'spoiled'; scan: Scan }
  | { kind: 'pastWindow'; scan: Scan };

/** Shared by the single-photo chat and the multi-photo scan (src/app/(tabs)/scan.tsx). */
export const STORAGES: { value: Storage; label: string }[] = [
  { value: 'ref', label: 'Ref' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'counter', label: 'Counter' },
];
export const PURCHASES: { value: Purchase; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'over_a_week', label: 'Over a week ago' },
  { value: 'not_sure', label: 'Not sure' },
];
export const BOUGHT: Record<Purchase, string> = {
  today: 'bought today',
  this_week: 'bought this week',
  over_a_week: 'bought over a week ago',
  not_sure: 'purchase date unknown',
};

/**
 * Cook-by window in words, from its safe end `days` to its longer end `max`:
 * Today, Today or tomorrow, 3–5 days, 2 days, 2–3 weeks, 4–6 months.
 */
export function windowText(days: number, max = days) {
  if (max <= 0) return 'Today';
  if (max === 1) return 'Today or tomorrow';
  // The safe end is today, but it may keep a little longer.
  if (days <= 0) return `Today, or within ${max} days`;
  const lo = days;
  if (max < 14) return lo === max ? `${max} days` : `${lo}–${max} days`;
  const [unit, size] = max < 60 ? ['weeks', 7] : ['months', 30];
  const a = Math.max(1, Math.round(lo / size));
  const b = Math.round(max / size);
  return a === b ? `About ${b} ${unit}` : `${a}–${b} ${unit}`;
}

/** The words before windowText on the result card (S06, S08). */
export function windowLead(days: number, max: number, notSure: boolean) {
  if (notSure) return 'Playing it safe: cook';
  return max >= 2 && days > 0 ? 'Suggested: cook within' : 'Suggested: cook';
}

/** One line for a result row (S07): "Cook within 3–5 days", "Cook today". */
export function cookLine(days: number, max = days) {
  return `Cook ${max >= 2 && days > 0 ? 'within ' : ''}${windowText(days, max).replace(/^About/, 'about').replace(/^T/, 't')}`;
}

/** Scanner chat header; `onClear` adds a button that empties the saved thread. */
export function ScanHeader({ onClear }: { onClear?: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
      <View style={{ flex: 1 }}>
        <ThemedText type="section" style={styles.headerTitle}>
          Freshness Scanner
        </ThemedText>
        <View style={styles.headerSub}>
          <Dot color="fresh" size={6} />
          <ThemedText type="caption" themeColor="fresh">
            On-device · offline ready
          </ThemedText>
        </View>
      </View>
      {onClear && (
        <Pressable onPress={onClear} accessibilityLabel="Clear chat" hitSlop={8} style={[styles.clear, { borderColor: theme.backgroundSelected }]}>
          <Ionicons name="trash-outline" size={16} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two + 2, borderBottomWidth: 1 },
  clear: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, lineHeight: 22 },
  headerSub: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
