import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pill } from '@/components/badges';
import { BudgetNote } from '@/components/budget';
import { BreakdownSheet, ChangePill, SwapSheet, WhySheet } from '@/components/price-sheets';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Stepper, Toast } from '@/components/controls';
import { FoodArt, hasRecipeImage } from '@/components/food-art';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { isBookmarked, toggleBookmark } from '@/db/bookmarks';
import { doneCooking, planFor, startPlan, type PlanState, type PlanUse } from '@/db/cook-plans';
import { listActivePantry, type PantryItem } from '@/db/pantry';
import { getProfile, profileSummary, type Profile } from '@/db/profile';
import { addToList, type ListLine } from '@/db/shopping';
import { budgetFlag, budgetFrom, spentThisWeek } from '@/domain/budget';
import { peso, priceMonth } from '@/domain/prices';
import { DEFAULT_PROFILE, getRecipe, swapFor, viewRecipe, type Line } from '@/domain/recipes';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { getMealProfile } from '@/lib/meal-profile';
import { api, apiConfigured } from '@/sync/api';
import { getSession } from '@/sync/session';

const MEAT_OR_FISH = new Set(['bangus', 'tilapia', 'galunggong', 'pork', 'chicken', 'beef']);

/**
 * R04 recipe detail (UC-3.4), R05 change servings (UC-3.7), R06 bookmark (UC-3.5),
 * R09 tick what you have (UC-3.10). `main` = the pantry item from Cook with this;
 * without it, the most urgent pantry item the dish uses. `view=1` (Library) is read-only.
 */
export default function RecipeDetailScreen() {
  const { id, servings: servingsParam, main, view: viewParam } = useLocalSearchParams<{
    id: string;
    servings?: string;
    main?: string;
    view?: string;
  }>();
  const recipe = getRecipe(id);
  const theme = useTheme();
  const load = useCallback(
    async (db: SQLiteDatabase) => {
      const [pantry, profile, saved, session, spent] = await Promise.all([
        listActivePantry(db),
        getProfile(db),
        isBookmarked(db, id),
        getSession(db),
        spentThisWeek(db),
      ]);
      const recipe = getRecipe(id);
      // The main ingredient: the item Cook with this (or a scan) opened it for; else the dish's own
      // main ingredient (its first) from the pantry, most urgent first; else any pantry item it uses.
      const uses = recipe ? new Set(recipe.ingredients.map((i) => i.item)) : new Set<string>();
      const mainItem =
        pantry.find((p) => p.id === main) ??
        pantry.find((p) => p.name === recipe?.ingredients[0]?.item) ??
        pantry.find((p) => uses.has(p.name)) ??
        null;
      const plan = mainItem ? await planFor(db, mainItem.id) : null;
      return { pantry, profile, saved, signedIn: !!session, spent, mainItem, plan };
    },
    [id, main],
  );
  const [data, reload] = useFocusQuery(
    load,
    null as {
      pantry: PantryItem[];
      profile: Profile | null;
      saved: boolean;
      signedIn: boolean;
      spent: number;
      mainItem: PantryItem | null;
      plan: PlanState | null;
    } | null,
  );

  if (!recipe) {
    return (
      <SafeAreaView style={[styles.safe, styles.centerAll, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">Recipe not found.</ThemedText>
        <Button title="Back" size="small" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!data) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;

  const profile = getMealProfile() ?? data.profile;
  const start = Number(servingsParam) || profile?.household_size || recipe.servings;
  return (
    <Detail
      key={recipe.id}
      recipeId={recipe.id}
      pantry={data.pantry}
      profile={profile}
      initialServings={start}
      initiallySaved={data.saved}
      signedIn={data.signedIn}
      weeklyBudget={data.profile?.weekly_budget_php ?? null}
      spent={data.spent}
      viewOnly={viewParam === '1'}
      mainItem={data.mainItem}
      plan={data.plan}
      onChanged={reload}
    />
  );
}

function Detail({
  recipeId,
  pantry,
  profile,
  initialServings,
  initiallySaved,
  signedIn,
  weeklyBudget,
  spent,
  viewOnly,
  mainItem,
  plan,
  onChanged,
}: {
  recipeId: string;
  pantry: PantryItem[];
  profile: Profile | null;
  initialServings: number;
  initiallySaved: boolean;
  signedIn: boolean;
  weeklyBudget: number | null;
  spent: number;
  viewOnly: boolean;
  mainItem: PantryItem | null;
  plan: PlanState | null;
  onChanged: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const recipe = getRecipe(recipeId)!;
  const [servings, setServings] = useState(initialServings);
  const [saved, setSaved] = useState(initiallySaved);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ kind: 'breakdown' } | { kind: 'why'; item: string } | { kind: 'swap' } | null>(null);
  // UC-3.10: what the user has. Pantry items start ticked; the main ingredient is locked.
  const [ticked, setTicked] = useState<Set<string>>(() => {
    const start = viewRecipe(recipe, pantry, initialServings).lines.filter((l) => l.have === 'all').map((l) => l.item);
    return new Set(mainItem ? [...start, mainItem.name] : start);
  });
  const hideToast = useCallback(() => setToast(null), [setToast]);
  // Community bookmark count (UC-3.5), when the sync server is reachable.
  const [community, setCommunity] = useState<number | null>(null);
  useEffect(() => {
    if (!apiConfigured()) return;
    api<Record<string, number>>(`/recipes/counts?ids=${encodeURIComponent(recipeId)}`).then(
      (counts) => setCommunity(counts[recipeId] ?? 0),
      () => {},
    );
  }, [recipeId]);

  const view = viewRecipe(recipe, pantry, servings);
  const mainKey = mainItem?.name ?? null;
  // Unticked lines go on the list: the part not in the pantry, or the whole line if unticked by hand.
  const toBuy: ListLine[] = view.lines
    .filter((l) => !ticked.has(l.item))
    .map((l) => ({ ...l, price: l.cost == null ? null : l.have === 'some' ? l.toBuy : l.cost }));
  const buyTotal = toBuy.reduce((s, l) => s + (l.price ?? 0), 0);
  const thisPlan = plan && plan.recipe_id === recipe.id ? plan : null;
  // UC-3.8: warn against the saved weekly budget; the dish stays cookable.
  const budget = budgetFrom(weeklyBudget, spent);
  const flag = budgetFlag(viewOnly ? view.toBuy : buyTotal, budget);
  // UC-4.3: a cheaper dish when the main ingredient is pricier than usual.
  const swap = swapFor(recipe, pantry, profile ?? DEFAULT_PROFILE, servings);
  const base = viewRecipe(recipe, pantry, recipe.servings);
  const scaled = servings !== recipe.servings;
  const inPantry = view.lines.filter((l) => l.have !== 'none').length;
  const fullyCovered = view.lines.filter((l) => l.have === 'all').length;
  const restrictions = profile ? profileSummary(profile).split(' · ').slice(1) : [];
  const fits = restrictions.length > 0 ? ` · fits ${restrictions.join(', ').toLowerCase()}` : '';

  async function bookmark() {
    const next = await toggleBookmark(db, recipe.id);
    setSaved(next);
    // Guests keep bookmarks on the phone; signed-in bookmarks also count toward the community total (R06/R07).
    if (signedIn && community != null) setCommunity(community + (next ? 1 : -1));
    setToast(
      next
        ? signedIn
          ? 'Saved to Library and added to the count. Syncs when you’re online.'
          : 'Saved to Library. Sign in to add your bookmark to the community count.'
        : 'Removed from Library.',
    );
  }

  function toggle(item: string) {
    if (item === mainKey) return;
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  /** UC-3.10 / 9.1: unticked lines go on the list; with a main ingredient the item now waits for them. */
  async function addOrStart() {
    if (!mainItem) {
      const { added, merged } = await addToList(db, recipe, toBuy);
      setToast(added + merged > 0 ? `Added ${toBuy.length} to your shopping list.` : 'Already on your shopping list.');
      return;
    }
    const uses: PlanUse[] = [mainItem, ...pantry.filter((p) => p.id !== mainItem.id)]
      .filter((p, i, all) => ticked.has(p.name) && all.findIndex((q) => q.name === p.name) === i)
      .map((p) => {
        const line = view.lines.find((l) => l.item === p.name);
        return { id: p.id, qty: line?.qty ?? p.quantity, unit: line?.unit ?? p.unit };
      });
    await startPlan(db, recipe, uses, toBuy);
    setToast(
      toBuy.length > 0
        ? `Added ${toBuy.length} to your list. Your ${mainItem.name} shows Done cooking once they're bought.`
        : `All set. Tap Done cooking when the ${recipe.title.toLowerCase()} is done.`,
    );
    onChanged();
  }

  /** UC-2.10 */
  function confirmDone(p: PlanState) {
    const name = mainItem?.name ?? 'item';
    Alert.alert('Done cooking?', `Your ${name} and the other ticked pantry items count as used in ${p.recipe_title}.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Done cooking',
        onPress: async () => {
          await doneCooking(db, p);
          router.dismissTo('/pantry');
        },
      },
    ]);
  }

  return (
    <View style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={[styles.hero, { backgroundColor: theme.highlight, paddingTop: insets.top }]}>
          {/* A photo fills the whole header; the placeholder keeps its tile at the bottom. */}
          <FoodArt size={160} radius={0} recipeId={recipeId} style={hasRecipeImage(recipeId) ? StyleSheet.absoluteFill : styles.heroArt} />
          <View style={[styles.heroBar, { top: insets.top + Spacing.two }]}>
            <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
            <RoundButton icon={saved ? 'bookmark' : 'bookmark-outline'} label={saved ? 'Remove bookmark' : 'Bookmark'} onPress={bookmark} active={saved} />
          </View>
        </View>

        <View style={styles.body}>
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="title">{recipe.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {recipe.description}
            </ThemedText>
            <View style={styles.meta}>
              <Meta icon="time-outline" text={`${recipe.minutes} min`} />
              <Meta icon="people-outline" text={`${recipe.servings} servings`} />
              {community != null && community > 0 ? (
                <Meta icon="bookmark-outline" text={`${community} bookmarked`} />
              ) : saved ? (
                <Meta icon="bookmark" text="Saved" />
              ) : null}
            </View>
            {view.uses.length > 0 && (
              <Pill
                label={`Uses ${view.uses.length} of your item${view.uses.length === 1 ? '' : 's'}${fits}`}
                tone={{ fg: 'fresh', bg: 'freshSoft' }}
              />
            )}
          </View>

          <Card>
            <View style={styles.between}>
              <View>
                <ThemedText type="small">Servings</ThemedText>
                {scaled && (
                  <ThemedText type="caption" themeColor="tintText">
                    Scaled from {recipe.servings} to {servings}
                  </ThemedText>
                )}
              </View>
              <Stepper value={servings} onChange={setServings} min={1} max={20} />
            </View>
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small">Estimated cost</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {scaled ? `was ≈ ${peso(base.cost)} for ${recipe.servings}` : `${priceMonth('long')} prices · NCR`}
                </ThemedText>
              </View>
              <ThemedText type="title" themeColor="tintText" style={{ fontSize: 24 }}>
                ≈ {peso(view.cost)}
                {view.unpriced > 0 ? '+' : ''}
              </ThemedText>
            </View>
            <View style={styles.between}>
              <ThemedText type="caption" themeColor="textSecondary" style={{ flex: 1 }}>
                {viewOnly
                  ? view.toBuy < 1
                    ? 'Everything is already in your pantry'
                    : `${peso(view.toBuy)} to buy · the rest is already in your pantry`
                  : buyTotal < 1
                    ? 'You have everything'
                    : `${peso(buyTotal)} to buy · the rest you have`}
                {view.unpriced > 0 ? ` · partial estimate, leaves out ${view.unpriced}` : ''}
              </ThemedText>
              <Pressable onPress={() => setSheet({ kind: 'breakdown' })} hitSlop={8} style={styles.inline}>
                <ThemedText type="label" themeColor="tintText">
                  Breakdown
                </ThemedText>
                <Ionicons name="chevron-forward" size={14} color={theme.tintText} />
              </Pressable>
            </View>
          </Card>
          {swap && (
            <Pressable onPress={() => setSheet({ kind: 'swap' })} accessibilityRole="button">
              <Card tone="freshSoft" style={styles.swapBanner}>
                <Ionicons name="swap-horizontal" size={18} color={theme.fresh} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">Save about {peso(swap.saves)}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {swap.to.title} instead · {swap.main} is pricier this month
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </Card>
            </Pressable>
          )}
          <BudgetNote flag={flag} toBuy={viewOnly ? view.toBuy : buyTotal} budget={budget} />

          <View style={{ gap: Spacing.two }}>
            <View style={styles.between}>
              <ThemedText type="section">{scaled ? `Ingredients for ${servings}` : 'Ingredients'}</ThemedText>
              <ThemedText type="label" themeColor={scaled ? 'tintText' : 'fresh'}>
                {!viewOnly && !thisPlan
                  ? 'Tick what you have'
                  : scaled
                    ? `${fullyCovered} of ${view.lines.length} fully covered`
                    : `${inPantry} of ${view.lines.length} in your pantry`}
              </ThemedText>
            </View>
            <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
              {view.lines.map((l, i) => (
                <IngredientRow
                  key={l.item}
                  line={l}
                  divider={i > 0}
                  onWhy={() => setSheet({ kind: 'why', item: l.item })}
                  tick={
                    viewOnly || thisPlan
                      ? undefined
                      : { on: ticked.has(l.item), main: l.item === mainKey, onToggle: () => toggle(l.item) }
                  }
                />
              ))}
            </Card>
          </View>

          <View style={{ gap: Spacing.three - 4 }}>
            <ThemedText type="section">Directions</ThemedText>
            {recipe.directions.map((step, i) => (
              <View key={i} style={styles.step}>
                <View style={[styles.stepNum, { backgroundColor: theme.highlight }]}>
                  <ThemedText type="label" themeColor="tintText">
                    {i + 1}
                  </ThemedText>
                </View>
                <ThemedText type="small" style={{ flex: 1 }}>
                  {step}
                </ThemedText>
              </View>
            ))}
            {recipe.ingredients.some((ing) => MEAT_OR_FISH.has(ing.item)) && (
              <View style={styles.inline}>
                <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
                <ThemedText type="caption" themeColor="textSecondary">
                  Check the smell and texture of meat or fish before cooking.
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {sheet?.kind === 'breakdown' && <BreakdownSheet view={view} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'why' && <WhySheet item={sheet.item} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'swap' && swap && (
        <SwapSheet
          swap={swap}
          fits={profile && profileSummary(profile).includes('·') ? profileSummary(profile).split(' · ').slice(1).join(', ').toLowerCase() : null}
          onClose={() => setSheet(null)}
        />
      )}

      <View style={[styles.toastSlot, { bottom: 96 + insets.bottom }]} pointerEvents="box-none">
        <Toast message={toast} onHide={hideToast} />
      </View>

      <View style={[styles.footer, { paddingBottom: Spacing.three + insets.bottom, backgroundColor: theme.backgroundElement, borderTopColor: theme.backgroundSelected }]}>
        <View style={styles.footerRow}>
          <Button
            title={saved ? 'Saved' : 'Bookmark'}
            icon={saved ? 'bookmark' : 'bookmark-outline'}
            variant={saved ? 'soft' : 'secondary'}
            onPress={bookmark}
          />
          {!viewOnly && (
            <View style={{ flex: 1 }}>
              {thisPlan ? (
                thisPlan.left_to_buy > 0 ? (
                  <Button
                    title={`Waiting · ${thisPlan.left_to_buy} left to buy`}
                    icon="list"
                    variant="soft"
                    onPress={() => router.push('/shopping')}
                  />
                ) : (
                  <Button title="Done cooking" icon="checkmark-done" onPress={() => confirmDone(thisPlan)} />
                )
              ) : toBuy.length > 0 ? (
                // UC-9.1: the button shows the count and cost, so no confirm sheet
                <Button title={`Add ${toBuy.length} to list · ${peso(buyTotal)}`} icon="list" onPress={addOrStart} />
              ) : mainItem ? (
                <Button title="Start cooking" icon="restaurant-outline" onPress={addOrStart} />
              ) : (
                <Button title="You have everything" icon="checkmark" variant="soft" onPress={() => {}} disabled />
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={icon} size={18} color={active ? theme.tint : theme.text} />
    </Pressable>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.inline}>
      <Ionicons name={icon} size={13} color={theme.textSecondary} />
      <ThemedText type="caption" themeColor="textSecondary">
        {text}
      </ThemedText>
    </View>
  );
}

function IngredientRow({
  line,
  divider,
  onWhy,
  tick,
}: {
  line: Line;
  divider: boolean;
  onWhy: () => void;
  /** R09: a checkbox meaning "I have this"; `main` is the locked main ingredient. */
  tick?: { on: boolean; main: boolean; onToggle: () => void };
}) {
  const theme = useTheme();
  const priceText = (n: number | null) => (n == null ? 'No price data' : peso(n));
  const right = tick ? (
    tick.main ? (
      <Pill label="Main ingredient" tone={{ fg: 'textSecondary', bg: 'backgroundSelected' }} />
    ) : tick.on ? (
      <Pill label="You have this" tone={{ fg: 'fresh', bg: 'freshSoft' }} />
    ) : (
      <ThemedText type="smallBold" style={{ fontFamily: Fonts.bold }}>
        {priceText(line.cost == null ? null : line.have === 'some' ? line.toBuy : line.cost)}
      </ThemedText>
    )
  ) : line.have === 'all' ? (
    <Pill label="You have this" tone={{ fg: 'fresh', bg: 'freshSoft' }} />
  ) : line.have === 'some' ? (
    <Pill label={line.haveText ?? 'You have some'} tone={{ fg: 'amber', bg: 'amberSoft' }} />
  ) : (
    <ThemedText type="smallBold" style={{ fontFamily: Fonts.bold }}>
      {priceText(line.cost)}
    </ThemedText>
  );
  const body = (
    <>
      {tick && (
        <View
          style={[
            styles.box,
            {
              borderColor: tick.main ? theme.textSecondary : theme.tint,
              backgroundColor: tick.main ? theme.textSecondary : tick.on ? theme.tint : 'transparent',
            },
          ]}>
          {tick.on && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.inline}>
          <ThemedText type="smallBold">{line.name}</ThemedText>
          {/* UC-4.2: tap the arrow to see why */}
          <Pressable onPress={onWhy} hitSlop={8} accessibilityLabel={`Why ${line.name} costs more or less this month`}>
            <ChangePill change={line.change} />
          </Pressable>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          {tick && !tick.on && line.have === 'some' ? `${line.amount} · ${line.haveText?.toLowerCase()}` : line.amount}
        </ThemedText>
      </View>
      {right}
    </>
  );
  const rowStyle = [
    styles.ingredient,
    divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
    tick?.main && { opacity: 0.55 },
  ];
  if (!tick) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable
      onPress={tick.onToggle}
      disabled={tick.main}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: tick.on, disabled: tick.main }}
      accessibilityLabel={tick.main ? `${line.name}, main ingredient` : `I have ${line.name}`}
      style={rowStyle}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerAll: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  hero: { height: 260, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  heroArt: { width: '100%', height: 200, backgroundColor: 'transparent' },
  heroBar: { position: 'absolute', left: Spacing.three + 4, right: Spacing.three + 4, flexDirection: 'row', justifyContent: 'space-between' },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.three + 4, gap: Spacing.four },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  divider: { height: 1, marginVertical: Spacing.one },
  swapBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  ingredient: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', gap: Spacing.three - 4, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  toastSlot: { position: 'absolute', left: Spacing.three, right: Spacing.three },
  footerRow: { flexDirection: 'row', gap: Spacing.two },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, paddingHorizontal: Spacing.three + 4, paddingTop: Spacing.three - 4 },
});
