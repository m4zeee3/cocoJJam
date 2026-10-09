import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dot } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { FoodArt } from '@/components/food-art';
import { QuickQuestions } from '@/components/quick-questions';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listActivePantry, type PantryItem } from '@/db/pantry';
import { ALLERGY_INFO, getProfile, profileSummary, saveProfile, type Profile } from '@/db/profile';
import { urgencyGroup } from '@/domain/cook-by';
import { peso, priceMonth } from '@/domain/prices';
import {
  DEFAULT_PROFILE,
  recommend,
  relaxProfile,
  simpleMethods,
  type Restriction,
  type RecipeView,
} from '@/domain/recipes';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { getMealProfile, setMealProfile } from '@/lib/meal-profile';
import { openScanner } from '@/lib/open-scanner';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function load(db: SQLiteDatabase) {
  const [pantry, profile] = await Promise.all([listActivePantry(db), getProfile(db)]);
  return { pantry, profile };
}

function relaxLabel(r: Restriction) {
  if (r.kind === 'allergy') return `Allow ${ALLERGY_INFO[r.value].label.toLowerCase()} this time`;
  if (r.kind === 'other') return `Allow ${r.value} this time`;
  return {
    no_pork: 'Allow pork this time',
    halal: 'Allow pork this time',
    vegetarian: 'Allow meat and fish this time',
    low_salt: 'Allow salty seasonings this time',
  }[r.value];
}

/** R03 Dishes for you (UC-3.1, 3.3), R08 no matches (UC-3.6). `?focus=bangus` = Cook with this (UC-2.7). */
export default function DishesScreen() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const [data, reload] = useFocusQuery(load, null as { pantry: PantryItem[]; profile: Profile | null } | null);
  const [meal, setMeal] = useState<Profile | null>(getMealProfile());
  const [asking, setAsking] = useState<'profile' | 'meal' | null>(null);

  if (!data) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;

  const profile = meal ?? data.profile;
  const active = profile ?? DEFAULT_PROFILE;
  const { matches, relax } = recommend(data.pantry, active, focus);
  const urgent = data.pantry.filter((p) => urgencyGroup(p.cook_by) !== 'Fresh').slice(0, 3);

  function applyMealProfile(p: Profile | null) {
    setMealProfile(p);
    setMeal(p);
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <ThemedText type="section" style={{ flex: 1 }}>
          Dishes for you
        </ThemedText>
        <RoundButton icon="options-outline" label="Filters" onPress={() => setAsking('profile')} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => setAsking('profile')}>
          <Card style={styles.profileRow}>
            <Ionicons name="people-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" style={{ flex: 1 }}>
              {profile ? profileSummary(profile) : 'Tell me about your household'}
            </ThemedText>
            <ThemedText type="label" themeColor="tintText">
              {profile ? 'Edit' : 'Set up'}
            </ThemedText>
          </Card>
        </Pressable>

        {meal && data.profile && (
          <Card tone="highlight" style={styles.profileRow}>
            <Ionicons name="time-outline" size={16} color={theme.tintText} />
            <ThemedText type="caption" style={{ flex: 1 }}>
              This meal only · {profileSummary(meal)}. Your saved profile stays as it is.
            </ThemedText>
            <Pressable onPress={() => applyMealProfile(null)} hitSlop={8}>
              <ThemedText type="label" themeColor="tintText">
                Undo
              </ThemedText>
            </Pressable>
          </Card>
        )}

        {(focus || urgent.length > 0) && (
          <View style={styles.usingFirst}>
            <ThemedText type="caption" themeColor="textSecondary">
              Using first:
            </ThemedText>
            {(focus ? [focus] : urgent.map((u) => u.name)).map((name) => (
              <View key={name} style={[styles.usingChip, { backgroundColor: theme.dangerSoft }]}>
                <Dot color="danger" size={6} />
                <ThemedText type="label" themeColor="danger">
                  {capitalize(name)}
                </ThemedText>
              </View>
            ))}
          </View>
        )}

        {matches.length > 0 ? (
          <>
            <ThemedText type="caption" themeColor="textSecondary">
              {matches.length} dish{matches.length === 1 ? '' : 'es'} · ranked by how many of your urgent items they use
            </ThemedText>
            {matches.map((r, i) => (
              <DishCard key={r.id} recipe={r} best={i === 0} />
            ))}
            <ThemedText type="caption" themeColor="textSecondary" style={styles.center}>
              Prices are estimates for {active.household_size} servings at {priceMonth('long')} prices (NCR)
            </ThemedText>
            {data.profile && !meal && (
              <View style={{ alignSelf: 'center' }}>
                <Button title="Change for this meal" size="small" variant="secondary" onPress={() => setAsking('meal')} />
              </View>
            )}
          </>
        ) : (
          <NoMatches
            focus={focus ?? urgent[0]?.name}
            pantryEmpty={data.pantry.length === 0}
            relax={relax}
            onRelax={(r) => applyMealProfile(relaxProfile(active, r))}
          />
        )}
      </ScrollView>

      {(asking || (data.profile === null && meal === null)) && (
        <QuickQuestions
          visible
          initial={active}
          mealOnly={asking === 'meal'}
          onClose={() => {
            setAsking(null);
            // Closing the first-time questions still shows dishes, unfiltered.
            if (!profile) applyMealProfile(DEFAULT_PROFILE);
          }}
          onSubmit={async (p, save) => {
            setAsking(null);
            if (save) {
              await saveProfile(db, p);
              setMealProfile(null);
              setMeal(null);
              reload();
            } else {
              applyMealProfile(p);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}

function DishCard({ recipe, best }: { recipe: RecipeView; best: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/recipes/[id]', params: { id: recipe.id, servings: String(recipe.servingsShown) } })
      }
      accessibilityRole="button">
      <Card style={[styles.dish, best && { borderColor: theme.tint, borderWidth: 1.5 }]}>
        <FoodArt size={72} />
        <View style={{ flex: 1, gap: 2 }}>
          {best && (
            <View style={[styles.best, { backgroundColor: theme.dangerSoft }]}>
              <ThemedText type="caption" themeColor="danger">
                Best match
              </ThemedText>
            </View>
          )}
          <ThemedText type="smallBold">{recipe.title}</ThemedText>
          <View style={styles.inline}>
            <Ionicons name="checkmark" size={12} color={theme.fresh} />
            <ThemedText type="caption" themeColor="fresh">
              Uses {recipe.uses.length} of your item{recipe.uses.length === 1 ? '' : 's'}
            </ThemedText>
          </View>
          <View style={styles.inline}>
            <ThemedText type="label" themeColor="tintText">
              ≈ {peso(recipe.cost)}
            </ThemedText>
            <Ionicons name="time-outline" size={12} color={theme.textSecondary} style={{ marginLeft: Spacing.two }} />
            <ThemedText type="caption" themeColor="textSecondary">
              {recipe.minutes} min
            </ThemedText>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function NoMatches({
  focus,
  pantryEmpty,
  relax,
  onRelax,
}: {
  focus?: string;
  pantryEmpty: boolean;
  relax: { restriction: Restriction; count: number; example: string }[];
  onRelax: (r: Restriction) => void;
}) {
  const theme = useTheme();
  return (
    <>
      <Card style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: theme.highlight }]}>
          <Ionicons name="search" size={22} color={theme.tint} />
        </View>
        <ThemedText type="section">No dishes match yet</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {pantryEmpty
            ? 'Scan or add a few items and I’ll suggest dishes that use them first.'
            : relax.length > 0
              ? 'The dishes for your items use something your filters leave out.'
              : 'I don’t have a recipe for these items yet.'}
        </ThemedText>
        {pantryEmpty && (
          <View style={{ alignSelf: 'stretch' }}>
            <Button title="Scan an item" icon="scan" onPress={() => openScanner()} />
          </View>
        )}
      </Card>

      {relax.length > 0 && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold">Relax a filter for this meal</ThemedText>
          {relax.map((r) => (
            <Card key={`${r.restriction.kind}:${r.restriction.value}`} style={styles.relaxRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{relaxLabel(r.restriction)}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {r.count} dish{r.count === 1 ? '' : 'es'}, like {r.example}
                </ThemedText>
              </View>
              <Button title="Show" size="small" variant="soft" onPress={() => onRelax(r.restriction)} />
            </Card>
          ))}
        </View>
      )}

      {focus && !pantryEmpty && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold">Or cook it simply</ThemedText>
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {simpleMethods(focus).map((m, i) => (
              <View key={m.title} style={[styles.simpleRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                <View style={[styles.simpleIcon, { backgroundColor: theme.freshSoft }]}>
                  <Ionicons name="leaf-outline" size={14} color={theme.fresh} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{m.title}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {m.minutes} min
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, paddingTop: Spacing.two, paddingBottom: 60, gap: Spacing.three },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three - 4 },
  usingFirst: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  usingChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dish: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, padding: Spacing.two + 2 },
  best: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: Spacing.three - 4, padding: Spacing.four },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  relaxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  simpleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  simpleIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
