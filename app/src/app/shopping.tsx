import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetBar } from '@/components/budget-bar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { Segmented, Sheet } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { ItemIcon } from '@/components/item-icon';
import { Spacing } from '@/constants/theme';
import { getProfile } from '@/db/profile';
import {
  budgetSwaps,
  listShopping,
  moveBoughtToPantry,
  recipeTags,
  removeFromList,
  setChecked,
  type BudgetSwap,
  type ShoppingItem,
} from '@/db/shopping';
import { budgetFrom, spentThisWeek } from '@/domain/budget';
import { peso, proteinOf } from '@/domain/prices';
import type { Storage } from '@/domain/types';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';

async function load(db: SQLiteDatabase) {
  const [items, profile, spent] = await Promise.all([listShopping(db), getProfile(db), spentThisWeek(db)]);
  return { items, budget: budgetFrom(profile?.weekly_budget_php, spent) };
}

/** N04 shopping list, N05 over budget, N06 bought items to pantry (UC-9.1). */
export default function ShoppingListScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [data, reload] = useFocusQuery(load, null as Awaited<ReturnType<typeof load>> | null);
  const [moving, setMoving] = useState(false);
  /** "Keep list as is": leave the N05 suggestions and show the list. */
  const [kept, setKept] = useState(false);

  if (!data) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;
  const { items, budget } = data;
  const open = items.filter((i) => !i.checked);
  const bought = items.filter((i) => i.checked);
  const total = open.reduce((s, i) => s + (i.price ?? 0), 0);
  const recipes = [...new Set(items.flatMap(recipeTags))];
  // N04: grouped by the recipe each item is for. An item shared by two recipes is one row,
  // under the first, marked "also for" the others.
  const groups = [...new Set(items.map((i) => recipeTags(i)[0] ?? 'Other items'))].map((g) => ({
    g,
    rows: items.filter((i) => (recipeTags(i)[0] ?? 'Other items') === g),
  }));
  const over = budget ? total - budget.left : 0;
  const swaps = over > 0 ? budgetSwaps(open) : [];
  // N05: over budget with a way down → show just the warning and the suggestions.
  const suggesting = swaps.length > 0 && !kept;
  const afterAll = total - swaps.reduce((sum, w) => sum + w.saves, 0);

  async function apply(list: BudgetSwap[]) {
    for (const w of list) await w.apply(db);
    reload();
  }

  async function toggle(i: ShoppingItem) {
    await setChecked(db, i.id, !i.checked);
    reload();
  }

  function share() {
    const text = groups
      .map(({ g, rows }) => `${g}\n${rows.map((i) => `${i.checked ? '☑' : '☐'} ${i.name}: ${i.amount}`).join('\n')}`)
      .join('\n\n');
    Share.share({ message: `Shopping list\n\n${text}\n\nTotal ≈ ${peso(total)}` });
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <ThemedText type="section">Shopping list</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {open.length} item{open.length === 1 ? '' : 's'} · from {recipes.length} recipe{recipes.length === 1 ? '' : 's'}
          </ThemedText>
        </View>
        {items.length > 0 && <RoundButton icon="share-outline" label="Share list" onPress={share} />}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.highlight }]}>
            <Ionicons name="list" size={28} color={theme.tint} />
          </View>
          <ThemedText type="section">Your list is empty</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Open a dish, tick what you have, and the rest goes on your list.
          </ThemedText>
          <View style={{ alignSelf: 'stretch' }}>
            <Button title="Find dishes to cook" onPress={() => router.push('/recipes')} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {over > 0 && budget ? (
            <Card tone="amberSoft" style={{ gap: Spacing.two }}>
              <View style={styles.inline}>
                <Ionicons name="warning-outline" size={16} color={theme.tintText} />
                <ThemedText type="smallBold" themeColor="tintText">
                  {peso(over)} over this week&apos;s budget
                </ThemedText>
              </View>
              <ThemedText type="caption">
                List total ≈ {peso(total)} · budget left {peso(budget.left)}
              </ThemedText>
              <BudgetBar budget={budget} adding={total} label="This week" />
            </Card>
          ) : (
            <Card style={{ gap: Spacing.two }}>
              <View style={styles.between}>
                <View>
                  <ThemedText type="caption" themeColor="textSecondary">
                    List total
                  </ThemedText>
                  <ThemedText type="title" themeColor="tintText" style={{ fontSize: 22 }}>
                    ≈ {peso(total)}
                  </ThemedText>
                </View>
                {budget && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      Weekly budget left
                    </ThemedText>
                    <ThemedText type="title" style={{ fontSize: 22 }}>
                      {peso(budget.left)}
                    </ThemedText>
                  </View>
                )}
              </View>
              {budget ? (
                <BudgetBar budget={budget} adding={total} label="This week" />
              ) : (
                <ThemedText type="caption" themeColor="textSecondary">
                  Set a weekly budget in your household profile to see how this fits.
                </ThemedText>
              )}
            </Card>
          )}

          {/* N05: ways to get under budget */}
          {suggesting && (
            <View style={{ gap: Spacing.two }}>
              <ThemedText type="caption" themeColor="textSecondary">
                WAYS TO GET UNDER BUDGET
              </ThemedText>
              <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
                {swaps.map((w, n) => (
                  <View key={w.item.id} style={[styles.row, n > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                    <SwapThumbs from={w.from} to={w.to} />
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">{w.title}</ThemedText>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {w.reason}
                      </ThemedText>
                    </View>
                    <Button title={`Save ${peso(w.saves)}`} size="small" variant="soft" onPress={() => apply([w])} />
                  </View>
                ))}
              </Card>
              <View style={styles.inline}>
                <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
                <ThemedText type="caption" themeColor={budget && afterAll <= budget.left ? 'fresh' : 'textSecondary'} style={{ flex: 1 }}>
                  {`${swaps.length === 1 ? 'This swap' : swaps.length === 2 ? 'Swapping both' : `Swapping all ${swaps.length}`} brings the list to ≈ ${peso(afterAll)}.`}
                  {budget && afterAll > budget.left ? ` Still ${peso(afterAll - budget.left)} over.` : ''}
                </ThemedText>
              </View>
            </View>
          )}
          {over > 0 && swaps.length === 0 && (
            <Note icon="information-circle-outline" tone="neutral">
              Remove something you can skip, or cook fewer servings to bring the total down.
            </Note>
          )}

          {!suggesting && groups.map(({ g, rows }) => {
            return (
              <View key={g} style={{ gap: Spacing.two }}>
                <ThemedText type="caption" themeColor="textSecondary">
                  {g.toUpperCase()}
                </ThemedText>
                <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
                  {rows.map((i, n) => (
                    <ListRow key={i.id} item={i} divider={n > 0} onToggle={() => toggle(i)} onRemove={async () => { await removeFromList(db, i.id); reload(); }} />
                  ))}
                </Card>
              </View>
            );
          })}
          <ThemedText type="caption" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Prices are estimates at this month&apos;s NCR prices. Checked items count as spent this week.
          </ThemedText>
        </ScrollView>
      )}

      {suggesting && (
        <View style={[styles.footer, { gap: Spacing.two }]}>
          <Button
            title={swaps.length === 1 ? 'Apply swap' : swaps.length === 2 ? 'Apply both swaps' : `Apply all ${swaps.length} swaps`}
            icon="swap-horizontal"
            onPress={() => apply(swaps)}
          />
          <Pressable onPress={() => setKept(true)} style={styles.textButton}>
            <ThemedText type="label" themeColor="tintText">
              Keep list as is
            </ThemedText>
          </Pressable>
        </View>
      )}

      {!suggesting && bought.length > 0 && (
        <View style={styles.footer}>
          <Button title={`Done shopping · ${bought.length} bought`} icon="bag-check-outline" onPress={() => setMoving(true)} />
        </View>
      )}

      {moving && (
        <MoveSheet
          bought={bought}
          onClose={() => setMoving(false)}
          onDone={() => {
            setMoving(false);
            reload();
          }}
        />
      )}
    </SafeAreaView>
  );
}

function ListRow({ item, divider, onToggle, onRemove }: { item: ShoppingItem; divider: boolean; onToggle: () => void; onRemove: () => void }) {
  const theme = useTheme();
  const on = !!item.checked;
  return (
    <View style={[styles.row, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
      <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.row, { flex: 1, paddingVertical: 0 }]}>
        <View style={[styles.box, { borderColor: on ? theme.tint : theme.backgroundSelected, backgroundColor: on ? theme.tint : 'transparent' }]}>
          {on && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
        <View style={{ flex: 1, opacity: on ? 0.5 : 1 }}>
          <ThemedText type="smallBold" style={on && styles.struck}>
            {item.name}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {[item.amount, recipeTags(item).length > 1 ? `also for ${recipeTags(item).slice(1).join(', ')}` : null]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" themeColor={on ? 'textSecondary' : 'text'}>
          {item.price == null ? '—' : peso(item.price)}
        </ThemedText>
      </Pressable>
      <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${item.name}`}>
        <Ionicons name="close" size={16} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

/** N06: choose storage for bought meat and fish; everything checked leaves the list. */
function MoveSheet({ bought, onClose, onDone }: { bought: ShoppingItem[]; onClose: () => void; onDone: () => void }) {
  const db = useSQLiteContext();
  const meat = bought.filter((i) => proteinOf(i.item));
  const others = bought.length - meat.length;
  const [storage, setStorage] = useState<Record<string, Storage>>({});
  return (
    <Sheet visible onClose={onClose}>
      <View>
        <ThemedText type="section">
          {meat.length > 0 ? `Add ${meat.length} bought item${meat.length === 1 ? '' : 's'} to your pantry?` : 'Done shopping?'}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {meat.length > 0 ? 'Bought today · countdown starts now' : 'Checked items leave your list.'}
        </ThemedText>
      </View>
      {meat.map((i) => (
        <Card key={i.id} tone="background" style={{ gap: Spacing.two }}>
          <View>
            <ThemedText type="smallBold">{i.name}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {i.amount}
            </ThemedText>
          </View>
          <Segmented
            value={storage[i.id] ?? 'ref'}
            onChange={(s) => setStorage((cur) => ({ ...cur, [i.id]: s }))}
            options={[
              { value: 'ref', label: 'Ref' },
              { value: 'freezer', label: 'Freezer' },
              { value: 'counter', label: 'Counter' },
            ]}
          />
        </Card>
      ))}
      {others > 0 && (
        <ThemedText type="caption" themeColor="textSecondary">
          {others} vegetable and seasoning item{others === 1 ? '' : 's'} will leave the list (the pantry tracks meat and fish only). Unchecked items stay on your list.
        </ThemedText>
      )}
      <Button
        title={meat.length > 0 ? 'Add to pantry' : 'Clear bought items'}
        icon={meat.length > 0 ? 'file-tray-full-outline' : 'checkmark'}
        onPress={async () => {
          await moveBoughtToPantry(db, storage);
          onDone();
        }}
      />
      <Pressable onPress={onClose} style={styles.textButton}>
        <ThemedText type="label" themeColor="tintText">
          Not now
        </ThemedText>
      </Pressable>
    </Sheet>
  );
}

/** Two overlapping thumbnails: the item and what replaces it (a leaf for vegetables). */
function SwapThumbs({ from, to }: { from: string; to: string | null }) {
  const theme = useTheme();
  const icon = (item: string) =>
    proteinOf(item) ? <ItemIcon name={item} size={18} /> : <Ionicons name="leaf-outline" size={18} color={theme.fresh} />;
  return (
    <View style={styles.thumbs}>
      <View style={[styles.thumb, { backgroundColor: theme.highlight, borderColor: theme.backgroundElement }]}>{icon(from)}</View>
      <View style={[styles.thumb, styles.thumbBack, { backgroundColor: to ? theme.freshSoft : theme.backgroundSelected, borderColor: theme.backgroundElement }]}>
        {to ? icon(to) : <Ionicons name="remove" size={18} color={theme.textSecondary} />}
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.three, paddingBottom: Spacing.five },
  between: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  struck: { textDecorationLine: 'line-through' },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
  thumbs: { flexDirection: 'row', width: 62 },
  thumb: { width: 38, height: 38, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  thumbBack: { marginLeft: -14 },
});
