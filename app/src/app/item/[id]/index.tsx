import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pill, StagePill, URGENCY_COLOR } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { FoodArt } from '@/components/food-art';
import { FreshnessCheck } from '@/components/freshness-check';
import { Note } from '@/components/chat';
import { ChoicePills, Segmented, Sheet, Stepper, Toast } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { ItemIcon } from '@/components/item-icon';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { cancelPlan, doneCooking, planFor, type PlanState } from '@/db/cook-plans';
import {
  finishPantryItem,
  getPantryItem,
  recompute,
  updatePantryItem,
  type PantryItem,
  type PantryPatch,
} from '@/db/pantry';
import { daysUntil, longCountdown, parseIsoDate, urgencyGroup } from '@/domain/cook-by';
import { pantryValue, peso } from '@/domain/prices';
import { dishesWith } from '@/domain/recipes';
import { PURCHASE_LABEL, STAGE_LABEL, STORAGE_LABEL, UNIT_LABEL, type Stage, type Storage } from '@/domain/types';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { pickPhoto } from '@/lib/open-scanner';
import { analyzePhoto, shortError, type Analysis } from '@/ml/classifier';
import { gateMessage } from '@/ml/gate';
import { MSG } from '@/ml/messages';
import { QUALITY_MESSAGE } from '@/ml/quality';
import { freshnessFor, itemOf } from '@/ml/read';

const STORAGES: { value: Storage; label: string }[] = [
  { value: 'ref', label: 'Ref' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'counter', label: 'Counter' },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** P05 item detail with storage change (P06), rescan (P07), used/wasted (P08) and check now (P09). */
export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const [data, reload] = useFocusQuery<{ item: PantryItem | null; plan: PlanState | null } | undefined>(
    async (d) => ({ item: await getPantryItem(d, id), plan: await planFor(d, id) }),
    undefined,
  );
  const item = data === undefined ? undefined : data.item;
  const plan = data?.plan ?? null;
  const [toast, setToast] = useState<{ message: string; undo?: PantryPatch } | null>(null);
  const [finishing, setFinishing] = useState<'used' | 'wasted' | null>(null);
  const [rescan, setRescan] = useState<{ photo: string; stage: Stage | null; ask?: string } | null>(null);
  const hideToast = useCallback(() => setToast(null), []);

  if (item === undefined) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;
  if (item === null) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">This item is no longer in your pantry.</ThemedText>
        <Button title="Back" variant="secondary" size="small" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const days = daysUntil(item.cook_by);
  const group = urgencyGroup(item.cook_by);
  const pastEstimate = group === 'Check now';

  async function changeStorage(storage: Storage) {
    if (!item || storage === item.storage) return;
    const before: PantryPatch = { storage: item.storage, cook_by: item.cook_by, confidence: item.confidence, rescan_tomorrow: item.rescan_tomorrow };
    const patch = recompute(item, { storage });
    await updatePantryItem(db, item.id, patch);
    const left = daysUntil(patch.cook_by!);
    setToast({
      message: `Moved to ${STORAGE_LABEL[storage].toLowerCase()}. Now good for ${left <= 0 ? 'today only' : `about ${longCountdown(left)}`}.`,
      undo: before,
    });
    reload();
  }

  async function undo() {
    if (!item || !toast?.undo) return;
    await updatePantryItem(db, item.id, toast.undo);
    setToast(null);
    reload();
  }

  async function startRescan() {
    const photo = await pickPhoto();
    if (!photo) return;
    setRescan({ photo, stage: null });
    try {
      await showRescan(photo, await analyzePhoto(photo));
    } catch (e) {
      setRescan(null);
      Alert.alert('Could not check that photo', shortError(e));
    }
  }

  /** Validation first (quality, not meat or fish), with the option to continue anyway. */
  async function showRescan(photo: string, a: Analysis) {
    if (a.kind !== 'ok') {
      setRescan(null);
      const text =
        a.kind === 'quality' ? QUALITY_MESSAGE[a.issue].text : a.kind === 'face' ? MSG.face : gateMessage(a.reject);
      // Only a quality problem can be overridden; a photo that isn't meat or fish must be retaken.
      const useAnyway = {
        text: 'Use it anyway',
        onPress: async () => {
          setRescan({ photo, stage: null });
          try {
            await showRescan(photo, await analyzePhoto(photo, { skipQuality: true }));
          } catch (e) {
            setRescan(null);
            Alert.alert('Could not check that photo', shortError(e));
          }
        },
      };
      Alert.alert('Check this photo', text, [
        { text: 'Retake photo', onPress: startRescan },
        ...(a.kind === 'quality' ? [useAnyway] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
      return;
    }
    // Only clear spoilage of this same item is taken from the photo; a fresh reading is a hint,
    // so the user's own check sets the stage (UC-1.4, P07, ml/read.ts).
    const known = itemOf(item!.name);
    const fresh = known ? freshnessFor(a.items, known, a.verdict) : 'unclear';
    if (fresh === 'spoiled') return setRescan({ photo, stage: 'spoiled' });
    if (fresh === 'fresh') return setRescan({ photo, stage: null, ask: MSG.looksFresh(known!) });
    const sameItem = known && a.verdict.confident && a.verdict.best.item === known;
    setRescan({ photo, stage: null, ask: sameItem ? MSG.unclearFreshness : "I can't tell for sure from this photo." });
  }

  async function saveRescan() {
    if (!item || !rescan?.stage) return;
    await updatePantryItem(db, item.id, {
      ...recompute(item, { stage: rescan.stage }),
      scan_count: item.scan_count + 1,
      thumbnail_uri: rescan.photo,
    });
    setRescan(null);
    reload();
  }

  function openMenu() {
    const edit = () => router.push({ pathname: '/item/[id]/edit', params: { id: item!.id } });
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Edit item', 'Cancel'], cancelButtonIndex: 1 }, (i) => i === 0 && edit());
    } else {
      Alert.alert(capitalize(item!.name), undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Edit item', onPress: edit }]);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.topBar}>
        <RoundIcon icon="chevron-back" label="Back" onPress={() => router.back()} />
        <RoundIcon icon="ellipsis-horizontal" label="More" onPress={openMenu} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: theme.highlight }]}>
          {item.thumbnail_uri ? (
            <Image source={{ uri: item.thumbnail_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <ItemIcon name={item.name} size={64} />
          )}
          <View style={styles.heroPill}>
            <Pill label={group} tone={{ fg: URGENCY_COLOR[group], bg: 'backgroundElement' }} />
          </View>
        </View>

        <View style={{ gap: 2 }}>
          <ThemedText type="title">{capitalize(item.name)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.quantity} {UNIT_LABEL[item.unit] ?? item.unit} · {STORAGE_LABEL[item.storage]} · Stage: {STAGE_LABEL[item.stage]}
          </ThemedText>
        </View>

        {pastEstimate ? (
          <Note icon="warning-outline" tone="amber">
            <ThemedText type="smallBold">Past the estimate</ThemedText>
            <ThemedText type="caption">
              It was best used by around {shortDate(parseIsoDate(item.cook_by))}. Check the smell and texture before
              cooking, or rescan for an update.
            </ThemedText>
          </Note>
        ) : (
          <CookByCard item={item} days={days} />
        )}

        {!pastEstimate && (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="label">Storage</ThemedText>
            <Segmented options={STORAGES} value={item.storage} onChange={changeStorage} />
          </View>
        )}

        <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
          <InfoRow
            label="Quantity"
            value={`${item.quantity} ${UNIT_LABEL[item.unit] ?? item.unit}`}
            action="Edit"
            onAction={() => router.push({ pathname: '/item/[id]/edit', params: { id: item.id } })}
          />
          <InfoRow label="Bought" value={PURCHASE_LABEL[item.purchase]} divider />
          <InfoRow
            label="Added"
            value={new Date(item.added_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            divider
          />
          <InfoRow label="Scan history" value={`${item.scan_count} scan${item.scan_count === 1 ? '' : 's'}`} divider />
        </Card>

        {pastEstimate ? (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="caption" themeColor="textSecondary">
              What would you like to do?
            </ThemedText>
            <Button title="Rescan" icon="scan" onPress={startRescan} />
            <View style={styles.row}>
              <Button title="Still good, used it" icon="checkmark" size="small" variant="secondary" onPress={() => setFinishing('used')} />
              <Button title="Threw it out" icon="trash-outline" size="small" variant="secondary" onPress={() => setFinishing('wasted')} />
            </View>
          </View>
        ) : (
          <View style={{ gap: Spacing.two }}>
            <CookButton item={item} plan={plan} onChanged={reload} />
            <View style={styles.row}>
              <Button title="Rescan" icon="scan" size="small" variant="secondary" onPress={startRescan} />
              <Button title="Used" icon="checkmark" size="small" variant="secondary" onPress={() => setFinishing('used')} />
              <Button title="Wasted" icon="trash-outline" size="small" variant="secondary" onPress={() => setFinishing('wasted')} />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.toastSlot} pointerEvents="box-none">
        <Toast message={toast?.message ?? null} action={toast?.undo ? 'Undo' : undefined} onAction={undo} onHide={hideToast} />
      </View>

      {finishing && (
        <FinishSheet
          item={item}
          initial={finishing}
          onClose={() => setFinishing(null)}
          onDone={(whole) => {
            setFinishing(null);
            if (whole) router.back();
            else reload();
          }}
        />
      )}

      <Sheet visible={!!rescan} onClose={() => setRescan(null)}>
        {rescan && (
          <RescanResult
            item={item}
            stage={rescan.stage}
            ask={rescan.ask}
            onOwnCheck={(stage) => setRescan({ ...rescan, stage, ask: undefined })}
            onSave={saveRescan}
            onAgain={() => {
              // Close the sheet first: iOS can't show the camera over an open modal.
              setRescan(null);
              setTimeout(startRescan, 400);
            }}
          />
        )}
      </Sheet>
    </SafeAreaView>
  );
}

/**
 * The item's cook button (Cook with this v2): Cook with this (UC-2.7) → Waiting for
 * ingredients while the recipe's list items aren't bought → Done cooking (UC-2.10).
 */
function CookButton({ item, plan, onChanged }: { item: PantryItem; plan: PlanState | null; onChanged: () => void }) {
  const db = useSQLiteContext();
  const cookWithThis = () => router.push({ pathname: '/recipes', params: { focus: item.name, main: item.id } });
  if (!plan) return <Button title="Cook with this" icon="restaurant-outline" onPress={cookWithThis} />;

  function changePlan() {
    Alert.alert(plan!.recipe_title, 'Its items you haven’t bought yet leave your shopping list.', [
      { text: 'Keep plan', style: 'cancel' },
      {
        text: 'Change recipe',
        onPress: async () => {
          await cancelPlan(db, plan!);
          cookWithThis();
        },
      },
      {
        text: 'Cancel plan',
        style: 'destructive',
        onPress: async () => {
          await cancelPlan(db, plan!);
          onChanged();
        },
      },
    ]);
  }

  function done() {
    Alert.alert('Done cooking?', `Your ${item.name} and the other ticked pantry items count as used in ${plan!.recipe_title}.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Done cooking',
        onPress: async () => {
          await doneCooking(db, plan!);
          router.dismissTo('/pantry');
        },
      },
    ]);
  }

  const waiting = plan.left_to_buy > 0;
  const viewRecipe = () => router.push({ pathname: '/recipes/[id]', params: { id: plan.recipe_id, main: item.id } });
  return (
    <View style={{ gap: Spacing.two }}>
      {/* The dish picked for this item (from Cook with this or a scan): open it any time before Done cooking. */}
      <Card style={styles.planCard}>
        <Pressable onPress={viewRecipe} accessibilityRole="button" accessibilityLabel={`View recipe: ${plan.recipe_title}`} style={styles.planMain}>
          <FoodArt size={44} radius={10} recipeId={plan.recipe_id} />
          <View style={{ flex: 1 }}>
            <ThemedText type="caption" themeColor="textSecondary">
              Planned dish
            </ThemedText>
            <ThemedText type="smallBold">{plan.recipe_title}</ThemedText>
            <ThemedText type="label" themeColor="tintText">
              View recipe ›
            </ThemedText>
          </View>
        </Pressable>
        <Pressable onPress={changePlan} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change or cancel this plan">
          <ThemedText type="label" themeColor="tintText">
            Change
          </ThemedText>
        </Pressable>
      </Card>
      {waiting ? (
        <Button
          title={`Waiting · ${plan.left_to_buy} left to buy`}
          icon="list"
          variant="soft"
          onPress={() => router.push('/shopping')}
        />
      ) : (
        <Button title="Done cooking" icon="checkmark-done" onPress={done} />
      )}
    </View>
  );
}

function RoundIcon({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={[styles.roundIcon, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}

function CookByCard({ item, days }: { item: PantryItem; days: number }) {
  const theme = useTheme();
  const urgent = days <= 3;
  const color: ThemeColor = days <= 1 ? 'danger' : urgent ? 'amber' : 'fresh';
  const total = Math.max(1, Math.round((parseIsoDate(item.cook_by).getTime() - parseIsoDate(item.date_added).getTime()) / 86_400_000));
  const fraction = Math.min(1, Math.max(0.04, days / total));
  const confidence = `${capitalize(item.confidence)} confidence`;
  return (
    <Card>
      <View style={styles.cookTop}>
        <View style={{ flex: 1 }}>
          <ThemedText type="caption" themeColor="textSecondary">
            {urgent ? 'Cook within' : 'Good for about'}
          </ThemedText>
          <ThemedText type="title" themeColor={color} style={{ fontSize: 24 }}>
            {longCountdown(days)}
          </ThemedText>
        </View>
        <Pill label={confidence} tone={{ fg: 'text', bg: 'backgroundSelected' }} />
      </View>
      <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.barFill, { width: `${fraction * 100}%`, backgroundColor: theme[color] }]} />
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        Suggested cook-by: around {shortDate(parseIsoDate(item.cook_by))} · an estimate, not an official expiry
        {item.rescan_tomorrow ? ' · rescan tomorrow' : ''}
      </ThemedText>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  action,
  onAction,
  divider,
}: {
  label: string;
  value: string;
  action?: string;
  onAction?: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.infoRow, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
      {action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <ThemedText type="label" themeColor="tintText">
            {action}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/** P07: before vs now after a rescan. */
function RescanResult({
  item,
  stage,
  ask,
  onOwnCheck,
  onSave,
  onAgain,
}: {
  item: PantryItem;
  stage: Stage | null;
  ask?: string;
  onOwnCheck: (stage: Stage) => void;
  onSave: () => void;
  onAgain: () => void;
}) {
  const theme = useTheme();
  if (!stage && ask) {
    return (
      <>
        <ThemedText type="small">{`${ask} ${MSG.ownCheck}`}</ThemedText>
        <FreshnessCheck item={itemOf(item.name)} onDone={onOwnCheck} />
      </>
    );
  }
  if (!stage) {
    return (
      <View style={[styles.row, { justifyContent: 'center', paddingVertical: Spacing.four }]}>
        <ActivityIndicator color={theme.tint} />
        <ThemedText type="small">Checking freshness on your phone…</ThemedText>
      </View>
    );
  }
  const next = recompute(item, { stage });
  // Time since purchase overrides how it looks: past the safe window is never "fresh".
  const pastWindow = stage !== 'spoiled' && daysUntil(next.cook_by!) < 0;
  const within = (cookBy: string) => (daysUntil(cookBy) < 0 ? 'Past safe date' : longCountdown(daysUntil(cookBy)));
  const rows: [string, string, string][] = [
    ['Stage', STAGE_LABEL[item.stage], STAGE_LABEL[stage]],
    ['Cook within', within(item.cook_by), within(next.cook_by!)],
    ['Confidence', capitalize(item.confidence), capitalize(next.confidence!)],
  ];
  return (
    <>
      <View>
        <ThemedText type="section">Updated after rescan</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {capitalize(item.name)} · scanned just now
        </ThemedText>
      </View>
      <Card tone="background" style={{ borderColor: theme.backgroundSelected }}>
        <View style={styles.compareRow}>
          <View style={{ flex: 1 }} />
          <ThemedText type="caption" themeColor="textSecondary" style={styles.compareCell}>
            BEFORE
          </ThemedText>
          <View style={{ width: 16 }} />
          <ThemedText type="caption" themeColor="tintText" style={styles.compareCell}>
            NOW
          </ThemedText>
        </View>
        {rows.map(([label, before, now]) => (
          <View key={label} style={styles.compareRow}>
            <ThemedText type="caption" themeColor="textSecondary" style={{ flex: 1 }}>
              {label}
            </ThemedText>
            {label === 'Stage' ? (
              <View style={styles.compareCell}>
                <StagePill stage={item.stage} />
              </View>
            ) : (
              <ThemedText type="smallBold" style={styles.compareCell}>
                {before}
              </ThemedText>
            )}
            <Ionicons name="arrow-forward" size={14} color={theme.textSecondary} style={{ width: 16 }} />
            {label === 'Stage' ? (
              <View style={styles.compareCell}>
                <StagePill stage={stage} />
              </View>
            ) : (
              <ThemedText type="smallBold" themeColor="tintText" style={styles.compareCell}>
                {now}
              </ThemedText>
            )}
          </View>
        ))}
      </Card>
      {pastWindow && (
        <Note icon="warning-outline" tone="danger">
          {`It's past the safe window for ${item.name} bought then and kept like this, even if it looks fine. Don't cook it.`}
        </Note>
      )}
      <ThemedText type="caption" themeColor="textSecondary">
        Both scans stay in this item&apos;s history. Photos never leave your phone.
      </ThemedText>
      <Button title="Save update" onPress={onSave} />
      <Pressable onPress={onAgain} style={styles.textButton}>
        <Ionicons name="scan" size={14} color={theme.tintText} />
        <ThemedText type="label" themeColor="tintText">
          Rescan again
        </ThemedText>
      </Pressable>
    </>
  );
}

/** P08: what happened to it, and how much. */
const WASTE_REASONS = ['slimy', 'smelled off', 'moldy', 'past estimate', 'forgot about it'];

function FinishSheet({
  item,
  initial,
  onClose,
  onDone,
}: {
  item: PantryItem;
  initial: 'used' | 'wasted';
  onClose: () => void;
  onDone: (whole: boolean) => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [status, setStatus] = useState(initial);
  const [qty, setQty] = useState(item.quantity);
  /** Optional: the dish (used) or the reason (wasted), shown in the Savings item log (N02). */
  const [note, setNote] = useState<string | null>(null);
  const noteOptions = (status === 'used' ? dishesWith(item.name) : WASTE_REASONS).map((n) => ({ value: n, label: n }));
  const step = item.unit === 'g' ? 50 : item.unit === 'kg' ? 0.25 : 1;
  const value = pantryValue({ ...item, quantity: qty });
  const unit = UNIT_LABEL[item.unit] ?? item.unit;

  const options: { value: 'used' | 'wasted'; title: string; body: string; icon: keyof typeof Ionicons.glyphMap; tone: ThemeColor }[] = [
    { value: 'used', title: 'I used it', body: 'Cooked or eaten. Counts as food saved.', icon: 'checkmark', tone: 'fresh' },
    { value: 'wasted', title: 'I threw it out', body: 'It spoiled. Counts toward food wasted.', icon: 'trash-outline', tone: 'danger' },
  ];

  return (
    <Sheet visible onClose={onClose}>
      <ThemedText type="section">What happened to the {item.name}?</ThemedText>
      {options.map((o) => {
        const selected = status === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              setStatus(o.value);
              setNote(null);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[
              styles.option,
              { borderColor: selected ? theme.tint : theme.backgroundSelected, backgroundColor: selected ? theme.highlight : theme.backgroundElement },
            ]}>
            <View style={[styles.optionIcon, { backgroundColor: o.tone === 'fresh' ? theme.freshSoft : theme.dangerSoft }]}>
              <Ionicons name={o.icon} size={16} color={theme[o.tone]} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{o.title}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {o.body}
              </ThemedText>
            </View>
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? theme.tint : theme.textSecondary} />
          </Pressable>
        );
      })}
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="label">How much?</ThemedText>
        <View style={styles.row}>
          <Stepper value={qty} onChange={setQty} min={step} max={item.quantity} step={step} />
          <ThemedText type="caption" themeColor="textSecondary">
            of {item.quantity} {unit}
          </ThemedText>
        </View>
      </View>
      {noteOptions.length > 0 && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="label">{status === 'used' ? 'What did you cook? (optional)' : 'What was wrong? (optional)'}</ThemedText>
          <ChoicePills options={noteOptions} value={note} onChange={(n) => setNote((cur) => (cur === n ? null : n))} />
        </View>
      )}
      {value > 0 && (
        <Note icon={status === 'used' ? 'checkmark' : 'trash-outline'} tone={status === 'used' ? 'fresh' : 'danger'}>
          {status === 'used' ? `+${peso(value)} added to your savings this month` : `${peso(value)} counted as wasted this month`}
        </Note>
      )}
      <Button
        title="Confirm"
        onPress={async () => {
          await finishPantryItem(db, item, status, qty, note);
          onDone(qty >= item.quantity);
        }}
      />
      <Pressable onPress={onClose} style={styles.textButton}>
        <ThemedText type="label" themeColor="tintText">
          Cancel
        </ThemedText>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  roundIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, paddingTop: Spacing.two, paddingBottom: 140, gap: Spacing.three + 4 },
  hero: { height: 200, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  heroPill: { position: 'absolute', top: 12, left: 12 },
  cookTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three - 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  toastSlot: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.five },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  compareCell: { width: 92 },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, borderWidth: 1, borderRadius: 14, padding: Spacing.three - 4 },
  optionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  planCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  textButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one + 2, paddingVertical: Spacing.two },
});
