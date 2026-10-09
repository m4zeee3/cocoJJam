import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Dot, STAGE_COLOR } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Segmented, Sheet } from '@/components/controls';
import { FoodArt } from '@/components/food-art';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listBookmarks, removeBookmark } from '@/db/bookmarks';
import { listRecentScans, type ScanRecord } from '@/db/history';
import { peso, priceMonth } from '@/domain/prices';
import { getRecipe, viewRecipe, type Recipe } from '@/domain/recipes';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';

type Saved = { recipe: Recipe; savedAt: number };

async function load(db: SQLiteDatabase) {
  const [scans, bookmarks] = await Promise.all([listRecentScans(db, 200), listBookmarks(db)]);
  const saved = bookmarks
    .map((b) => ({ recipe: getRecipe(b.recipe_id), savedAt: b.updated_at }))
    .filter((s): s is Saved => s.recipe != null);
  return { scans, saved };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dayGroup(ms: number, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= start) return 'Today';
  if (ms >= start - 86_400_000) return 'Yesterday';
  if (ms >= start - 6 * 86_400_000) return 'This week';
  return 'Earlier';
}

/** Module 7: Library with Scans (UC-7.1) and Recipes (UC-7.2) tabs. Everything stays on the phone. */
export default function LibraryScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [tab, setTab] = useState<'scans' | 'recipes'>('scans');
  const [data, reload] = useFocusQuery(load, { scans: [] as ScanRecord[], saved: [] as Saved[] });
  const [removing, setRemoving] = useState<Saved | null>(null);

  return (
    <Screen>
      <ThemedText type="title">Library</ThemedText>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'scans', label: `Scans ${data.scans.length}` },
          { value: 'recipes', label: `Recipes ${data.saved.length}` },
        ]}
      />
      {tab === 'scans' ? <ScansTab scans={data.scans} /> : <RecipesTab saved={data.saved} onRemove={setRemoving} />}

      {/* L05: remove a bookmark (UC-7.3) */}
      <Sheet visible={!!removing} onClose={() => setRemoving(null)}>
        {removing && (
          <>
            <ThemedText type="section">Remove from bookmarks?</ThemedText>
            <Card tone="background" style={styles.removeRow}>
              <FoodArt size={44} />
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{removing.recipe.title}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  Saved {new Date(removing.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </ThemedText>
              </View>
            </Card>
            <ThemedText type="caption" themeColor="textSecondary">
              As a guest, it&apos;s only removed from this phone.
            </ThemedText>
            <Pressable
              onPress={async () => {
                await removeBookmark(db, removing.recipe.id);
                setRemoving(null);
                reload();
              }}
              accessibilityRole="button"
              style={[styles.dangerButton, { backgroundColor: theme.danger }]}>
              <ThemedText type="smallBold" style={{ color: '#fff' }}>
                Remove bookmark
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => setRemoving(null)} style={styles.textButton}>
              <ThemedText type="label" themeColor="tintText">
                Keep it
              </ThemedText>
            </Pressable>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/** L01: past scans grouped by day. */
function ScansTab({ scans }: { scans: ScanRecord[] }) {
  if (scans.length === 0) {
    return (
      <Empty
        icon="scan"
        title="No scans yet"
        body="Every scan is saved here, so you can look back at what you checked."
        action="Scan an item"
        onPress={() => openScanner()}
      />
    );
  }
  const groups: { title: string; rows: ScanRecord[] }[] = [];
  for (const s of scans) {
    const title = dayGroup(s.created_at);
    const last = groups[groups.length - 1];
    if (last?.title === title) last.rows.push(s);
    else groups.push({ title, rows: [s] });
  }
  return (
    <>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: Spacing.two }}>
          <ThemedText type="caption" themeColor="textSecondary">
            {g.title.toUpperCase()}
          </ThemedText>
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {g.rows.map((s, i) => (
              <ScanRow key={s.id} scan={s} divider={i > 0} />
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

function ScanRow({ scan, divider }: { scan: ScanRecord; divider: boolean }) {
  const theme = useTheme();
  const when = new Date(scan.created_at);
  const time =
    dayGroup(scan.created_at) === 'Today' || dayGroup(scan.created_at) === 'Yesterday'
      ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : when.toLocaleDateString('en-US', { weekday: 'short' });
  const spoiled = scan.items.length === 1 && scan.items[0].stage === 'spoiled';
  const detail = spoiled ? 'Spoiled' : `${scan.items.length} item${scan.items.length === 1 ? '' : 's'}`;
  const photo = scan.items.find((i) => i.photo)?.photo;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/scans/[id]', params: { id: scan.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.scanRow, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
        {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="scan" size={16} color={theme.tint} />}
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{scan.items.map((i) => capitalize(i.name)).join(', ')}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {time} · {detail}
        </ThemedText>
      </View>
      <View style={styles.dots}>
        {scan.items.map((i, n) => (
          <Dot key={n} color={STAGE_COLOR[i.stage]} size={7} />
        ))}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

/** L04: saved recipes as a grid, priced at this month's prices. */
function RecipesTab({ saved, onRemove }: { saved: Saved[]; onRemove: (s: Saved) => void }) {
  const theme = useTheme();
  if (saved.length === 0) {
    return (
      <Empty
        icon="bookmark-outline"
        title="No saved recipes yet"
        body="Tap the bookmark on any dish to keep it here, with prices updated each month."
        action="Find dishes to cook"
        onPress={() => router.push('/recipes')}
      />
    );
  }
  return (
    <>
      <View style={styles.between}>
        <View style={styles.inline}>
          <Ionicons name="swap-vertical" size={12} color={theme.text} />
          <ThemedText type="caption">Recently saved</ThemedText>
        </View>
        <ThemedText type="caption" themeColor="fresh">
          Prices updated to {priceMonth('long')}
        </ThemedText>
      </View>
      <View style={styles.grid}>
        {saved.map((s) => {
          const cost = viewRecipe(s.recipe, [], s.recipe.servings).cost;
          return (
            <Pressable
              key={s.recipe.id}
              onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: s.recipe.id } })}
              accessibilityRole="button"
              style={styles.cell}>
              <Card style={styles.recipeCard}>
                <FoodArt size={0} style={styles.cellArt} />
                <Pressable onPress={() => onRemove(s)} accessibilityLabel="Remove bookmark" hitSlop={8} style={[styles.bookmark, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="bookmark" size={14} color={theme.tint} />
                </Pressable>
                <ThemedText type="smallBold" numberOfLines={2}>
                  {s.recipe.title}
                </ThemedText>
                <View style={styles.inline}>
                  <ThemedText type="label" themeColor="tintText">
                    ≈ {peso(cost)}
                  </ThemedText>
                  <Ionicons name="time-outline" size={12} color={theme.textSecondary} style={{ marginLeft: Spacing.one }} />
                  <ThemedText type="caption" themeColor="textSecondary">
                    {s.recipe.minutes} min
                  </ThemedText>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function Empty({
  icon,
  title,
  body,
  action,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.highlight }]}>
        <Ionicons name={icon} size={28} color={theme.tint} />
      </View>
      <ThemedText type="section">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {body}
      </ThemedText>
      <View style={{ alignSelf: 'stretch' }}>
        <Button title={action} onPress={onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  thumb: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 3 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three - 4 },
  cell: { width: '47.5%' },
  recipeCard: { padding: Spacing.two, gap: Spacing.one },
  cellArt: { width: '100%', height: 110 },
  bookmark: { position: 'absolute', top: Spacing.three, right: Spacing.three, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.five },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  removeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  dangerButton: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
