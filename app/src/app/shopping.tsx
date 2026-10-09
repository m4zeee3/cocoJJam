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
import { Spacing } from '@/constants/theme';
import { getProfile } from '@/db/profile';
import { applySwap, listShopping, moveBoughtToPantry, proteinSwap, removeFromList, setChecked, type ShoppingItem } from '@/db/shopping';
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

  if (!data) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;
  const { items, budget } = data;
  const open = items.filter((i) => !i.checked);
  const bought = items.filter((i) => i.checked);
  const total = open.reduce((s, i) => s + (i.price ?? 0), 0);
  const recipes = [...new Set(items.map((i) => i.recipe_title ?? 'Other'))];
  const over = budget ? total - budget.left : 0;
  const swaps = over > 0 ? open.map((i) => ({ i, s: proteinSwap(i) })).filter((x) => x.s) : [];

  async function toggle(i: ShoppingItem) {
    await setChecked(db, i.id, !i.checked);
    reload();
  }

  function share() {
    const text = recipes
      .map((r) => `${r}\n${items.filter((i) => (i.recipe_title ?? 'Other') === r).map((i) => `${i.checked ? '☑' : '☐'} ${i.name}: ${i.amount}`).join('\n')}`)
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
            Open a dish and tap Add to list. Only what your pantry doesn&apos;t have is added.
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
          {swaps.length > 0 && (
            <View style={{ gap: Spacing.two }}>
              <ThemedText type="caption" themeColor="textSecondary">
                WAYS TO GET UNDER BUDGET
              </ThemedText>
              <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
                {swaps.map(({ i, s }, n) => (
                  <View key={i.id} style={[styles.row, n > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold">Swap {i.name.toLowerCase()} for chicken</ThemedText>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {i.recipe_title} · same weight, {i.amount.split(',')[0]}
                      </ThemedText>
                    </View>
                    <Button
                      title={`Save ${peso(s!.saves)}`}
                      size="small"
                      variant="soft"
                      onPress={async () => {
                        await applySwap(db, i, s!.price);
                        reload();
                      }}
                    />
                  </View>
                ))}
              </Card>
            </View>
          )}
          {over > 0 && swaps.length === 0 && (
            <Note icon="information-circle-outline" tone="neutral">
              Remove something you can skip, or cook fewer servings to bring the total down.
            </Note>
          )}

          {recipes.map((r) => {
            const rows = items.filter((i) => (i.recipe_title ?? 'Other') === r);
            return (
              <View key={r} style={{ gap: Spacing.two }}>
                <ThemedText type="caption" themeColor="textSecondary">
                  {r.toUpperCase()}
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

      {bought.length > 0 && (
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
            {item.amount}
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
});
