import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Stepper, Toast } from '@/components/controls';
import { FoodArt } from '@/components/food-art';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { isBookmarked, toggleBookmark } from '@/db/bookmarks';
import { listActivePantry, type PantryItem } from '@/db/pantry';
import { getProfile, profileSummary, type Profile } from '@/db/profile';
import { peso, priceMonth } from '@/domain/prices';
import { getRecipe, viewRecipe, type Line } from '@/domain/recipes';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { getMealProfile } from '@/lib/meal-profile';
import { api, apiConfigured } from '@/sync/api';
import { getSession } from '@/sync/session';

const MEAT_OR_FISH = new Set(['bangus', 'tilapia', 'galunggong', 'pork', 'chicken', 'beef']);

/** R04 recipe detail (UC-3.4), R05 change servings (UC-3.7), R06 bookmark (UC-3.5). */
export default function RecipeDetailScreen() {
  const { id, servings: servingsParam } = useLocalSearchParams<{ id: string; servings?: string }>();
  const recipe = getRecipe(id);
  const theme = useTheme();
  const load = useCallback(
    async (db: SQLiteDatabase) => {
      const [pantry, profile, saved, session] = await Promise.all([
        listActivePantry(db),
        getProfile(db),
        isBookmarked(db, id),
        getSession(db),
      ]);
      return { pantry, profile, saved, signedIn: !!session };
    },
    [id],
  );
  const [data] = useFocusQuery(load, null as { pantry: PantryItem[]; profile: Profile | null; saved: boolean; signedIn: boolean } | null);

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
}: {
  recipeId: string;
  pantry: PantryItem[];
  profile: Profile | null;
  initialServings: number;
  initiallySaved: boolean;
  signedIn: boolean;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const recipe = getRecipe(recipeId)!;
  const [servings, setServings] = useState(initialServings);
  const [saved, setSaved] = useState(initiallySaved);
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
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

  return (
    <View style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={[styles.hero, { backgroundColor: theme.highlight, paddingTop: insets.top }]}>
          <FoodArt size={160} radius={0} style={styles.heroArt} />
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
              </ThemedText>
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              {view.toBuy < 1
                ? 'Everything is already in your pantry'
                : `${peso(view.toBuy)} to buy · the rest is already in your pantry`}
              {view.partialCost ? ' · some items have no price data' : ''}
            </ThemedText>
          </Card>

          <View style={{ gap: Spacing.two }}>
            <View style={styles.between}>
              <ThemedText type="section">{scaled ? `Ingredients for ${servings}` : 'Ingredients'}</ThemedText>
              <ThemedText type="label" themeColor={scaled ? 'tintText' : 'fresh'}>
                {scaled ? `${fullyCovered} of ${view.lines.length} fully covered` : `${inPantry} of ${view.lines.length} in your pantry`}
              </ThemedText>
            </View>
            <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
              {view.lines.map((l, i) => (
                <IngredientRow key={l.item} line={l} divider={i > 0} />
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

      <View style={[styles.toastSlot, { bottom: 96 + insets.bottom }]} pointerEvents="box-none">
        <Toast message={toast} onHide={hideToast} />
      </View>

      <View style={[styles.footer, { paddingBottom: Spacing.three + insets.bottom, backgroundColor: theme.backgroundElement, borderTopColor: theme.backgroundSelected }]}>
        {/* TODO: "Add N to list" once the Auto Shopping List (Module 9) exists. */}
        <Button title={saved ? 'Saved' : 'Bookmark'} icon={saved ? 'bookmark' : 'bookmark-outline'} variant={saved ? 'soft' : 'primary'} onPress={bookmark} />
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

function IngredientRow({ line, divider }: { line: Line; divider: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.ingredient, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{line.name}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {line.amount}
        </ThemedText>
      </View>
      {line.have === 'all' ? (
        <Pill label="You have this" tone={{ fg: 'fresh', bg: 'freshSoft' }} />
      ) : line.have === 'some' ? (
        <Pill label={line.haveText ?? 'You have some'} tone={{ fg: 'amber', bg: 'amberSoft' }} />
      ) : (
        <ThemedText type="smallBold" style={{ fontFamily: Fonts.bold }}>
          {line.cost == null ? 'No price' : peso(line.cost)}
        </ThemedText>
      )}
    </View>
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
  ingredient: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2 },
  step: { flexDirection: 'row', gap: Spacing.three - 4, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  toastSlot: { position: 'absolute', left: Spacing.three, right: Spacing.three },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, paddingHorizontal: Spacing.three + 4, paddingTop: Spacing.three - 4 },
});
