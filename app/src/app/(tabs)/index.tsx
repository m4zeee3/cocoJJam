import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Dot, OnDeviceBadge, Pill, STAGE_COLOR, URGENCY_COLOR } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { listRecentScans, type ScanRecord } from '@/db/history';
import { listActivePantry, type PantryItem } from '@/db/pantry';
import { getProfile, type Profile } from '@/db/profile';
import { loadSamplePantry } from '@/db/sample';
import { parseIsoDate, urgencyGroup } from '@/domain/cook-by';
import { pantryValue, peso, priceMonth, priceWatch } from '@/domain/prices';
import { DEFAULT_PROFILE, recommend, type RecipeView } from '@/domain/recipes';
import { STORAGE_LABEL, UNIT_LABEL, type Urgency } from '@/domain/types';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Magandang umaga' : h < 18 ? 'Magandang hapon' : 'Magandang gabi';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function loadHome(db: Parameters<typeof listActivePantry>[0]) {
  const [items, scans, profile] = await Promise.all([listActivePantry(db), listRecentScans(db, 2), getProfile(db)]);
  return { items, scans, profile };
}

/** Home: Today dashboard. UC-12.1 first-time user, UC-12.2 returning user. */
export default function HomeScreen() {
  const db = useSQLiteContext();
  const [{ items, scans, profile }, reload] = useFocusQuery(loadHome, {
    items: [] as PantryItem[],
    scans: [] as ScanRecord[],
    profile: null as Profile | null,
  });

  return (
    <Screen>
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="title">{greeting()}!</ThemedText>
        <OnDeviceBadge />
      </View>
      <Today
        items={items}
        scans={scans}
        profile={profile}
        onSample={() =>
          loadSamplePantry(db).then(reload, (e: Error) => Alert.alert('Could not load sample items', e.message))
        }
      />
    </Screen>
  );
}

function SectionHeader({ title, link, onPress }: { title: string; link?: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText type="section">{title}</ThemedText>
      {link && (
        <Pressable onPress={onPress} style={styles.link} hitSlop={8}>
          <ThemedText type="label" themeColor="tintText">
            {link}
          </ThemedText>
          <Ionicons name="chevron-forward" size={14} color={theme.tintText} />
        </Pressable>
      )}
    </View>
  );
}

function Today({
  items,
  scans,
  profile,
  onSample,
}: {
  items: PantryItem[];
  scans: ScanRecord[];
  profile: Profile | null;
  onSample: () => void;
}) {
  const groups = items.map((i) => ({ item: i, group: urgencyGroup(i.cook_by) }));
  const count = (g: Urgency[]) => groups.filter((x) => g.includes(x.group)).length;
  const urgent = groups.filter((x) => x.group === 'Use today' || x.group === 'Check now').map((x) => x.item);
  const weekAhead = new Date();
  weekAhead.setDate(weekAhead.getDate() + 7);
  const expiringValue = items
    .filter((i) => parseIsoDate(i.cook_by) <= weekAhead)
    .reduce((sum, i) => sum + pantryValue(i), 0);
  const recipe = recommend(items, profile ?? DEFAULT_PROFILE, undefined, 1).matches[0];
  const watch = priceWatch()[0];

  return (
    <>
      <SummaryCard
        urgent={urgent.length}
        expiringValue={expiringValue}
        counts={[
          ['Use today', count(['Use today', 'Check now'])],
          ['Use soon', count(['Use soon'])],
          ['Fresh', count(['Fresh'])],
        ]}
      />

      <View style={styles.section}>
        <SectionHeader title="Use today" link="See pantry" onPress={() => router.navigate('/pantry')} />
        {items.length === 0 ? (
          <EmptyPantryCard onSample={onSample} />
        ) : urgent.length === 0 ? (
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              Nothing needs cooking today. Nice!
            </ThemedText>
          </Card>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
            {urgent.map((item) => (
              <UseTodayCard key={item.id} item={item} />
            ))}
          </ScrollView>
        )}
      </View>

      {recipe && (
        <View style={styles.section}>
          <SectionHeader title="Cook before it spoils" link="More dishes" onPress={() => router.push('/recipes')} />
          <RecipeCard recipe={recipe} />
        </View>
      )}

      {scans.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Recent scans" />
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {scans.map((s, i) => (
              <RecentScanRow key={s.id} scan={s} divider={i > 0} />
            ))}
          </Card>
        </View>
      )}

      {watch && <PriceWatchCard item={watch.item} reason={watch.reason} />}
    </>
  );
}

function SummaryCard({
  urgent,
  expiringValue,
  counts,
}: {
  urgent: number;
  expiringValue: number;
  counts: [Urgency, number][];
}) {
  const theme = useTheme();
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  return (
    <Card tone="highlight" style={styles.summary}>
      <ThemedText type="label" themeColor="tintText">
        TODAY · {today}
      </ThemedText>
      <ThemedText type="title">
        {urgent === 0 ? (
          'Nothing to use today'
        ) : (
          <>
            <ThemedText type="title" themeColor="tint">
              {urgent} item{urgent === 1 ? '' : 's'}
            </ThemedText>{' '}
            to use today
          </>
        )}
      </ThemedText>
      {expiringValue > 0 && (
        <ThemedText type="small">
          <ThemedText type="small" themeColor="tintText" style={{ fontFamily: Fonts.bold }}>
            {peso(expiringValue)}
          </ThemedText>{' '}
          worth of food expiring this week
        </ThemedText>
      )}
      <View style={styles.counts}>
        {counts.map(([label, n]) => (
          <View key={label} style={[styles.countChip, { backgroundColor: theme.backgroundElement }]}>
            <Dot color={URGENCY_COLOR[label]} size={7} />
            <ThemedText type="label">
              {n} {label}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

function UseTodayCard({ item }: { item: PantryItem }) {
  const theme = useTheme();
  return (
    <Pressable onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })} accessibilityRole="button">
      <Card style={styles.useCard}>
        <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
          {item.thumbnail_uri ? (
            <Image source={{ uri: item.thumbnail_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Ionicons name="nutrition-outline" size={36} color={theme.tint} />
          )}
          <View style={styles.thumbPill}>
            <Pill label="Cook today" tone={{ fg: 'danger', bg: 'dangerSoft' }} />
          </View>
        </View>
        <ThemedText type="smallBold">{capitalize(item.name)}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {item.quantity} {UNIT_LABEL[item.unit] ?? item.unit} · {STORAGE_LABEL[item.storage]}
        </ThemedText>
      </Card>
    </Pressable>
  );
}

/** UC-3.1 top pick: the dish that uses the most urgent pantry items. */
function RecipeCard({ recipe }: { recipe: RecipeView }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: recipe.id, servings: String(recipe.servingsShown) } })}
      accessibilityRole="button">
      <Card style={{ padding: Spacing.two, gap: Spacing.two }}>
        <View style={[styles.recipeArt, { backgroundColor: theme.highlight }]}>
          <Ionicons name="restaurant-outline" size={56} color={theme.tint} />
          <View style={styles.recipeUses}>
            <Pill
              label={`Uses ${recipe.uses.length} of your item${recipe.uses.length === 1 ? '' : 's'}`}
              tone={{ fg: 'fresh', bg: 'backgroundElement' }}
            />
          </View>
        </View>
        <View style={{ paddingHorizontal: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.one }}>
          <View style={styles.recipeTitleRow}>
            <ThemedText type="section" style={{ flex: 1, fontSize: 17 }}>
              {recipe.title}
            </ThemedText>
            <ThemedText type="section" themeColor="tintText" style={{ fontSize: 17 }}>
              ≈ {peso(recipe.cost)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {recipe.description}
          </ThemedText>
          <View style={styles.meta}>
            <MetaItem icon="time-outline" text={`${recipe.minutes} min`} />
            <MetaItem icon="people-outline" text={`${recipe.servingsShown} servings`} />
            <MetaItem icon="pricetag-outline" text={`${priceMonth()} prices${recipe.partialCost ? ', partial' : ''}`} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function MetaItem({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={theme.textSecondary} />
      <ThemedText type="caption" themeColor="textSecondary">
        {text}
      </ThemedText>
    </View>
  );
}

function RecentScanRow({ scan, divider }: { scan: ScanRecord; divider: boolean }) {
  const theme = useTheme();
  const when = new Date(scan.created_at);
  const isToday = when.toDateString() === new Date().toDateString();
  const day = isToday
    ? `Today, ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <View style={[styles.scanRow, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
      <View style={[styles.scanIcon, { backgroundColor: theme.highlight }]}>
        <Ionicons name="scan" size={16} color={theme.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{scan.items.map((i) => capitalize(i.name)).join(', ')}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {day} · {scan.items.length} item{scan.items.length === 1 ? '' : 's'}
        </ThemedText>
      </View>
      <View style={styles.dots}>
        {scan.items.map((i, n) => (
          <Dot key={n} color={STAGE_COLOR[i.stage]} size={7} />
        ))}
      </View>
    </View>
  );
}

/** UC-4.2: an item priced above its usual range this month. */
function PriceWatchCard({ item, reason }: { item: string; reason: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.watch}>
      <View style={[styles.scanIcon, { backgroundColor: theme.highlight }]}>
        <Ionicons name="trending-up" size={16} color={theme.tint} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="label" themeColor="tintText">
          PRICE WATCH · {priceMonth('long').toUpperCase()}
        </ThemedText>
        <ThemedText type="smallBold">{capitalize(item)} costs more this month</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {reason}
        </ThemedText>
      </View>
    </Card>
  );
}

/** Shown in the Use today section while the pantry is empty. */
function EmptyPantryCard({ onSample }: { onSample: () => void }) {
  const theme = useTheme();
  return (
    <Card style={styles.emptyCard}>
      <View style={[styles.scanIcon, { backgroundColor: theme.highlight }]}>
        <Ionicons name="scan" size={18} color={theme.tint} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="smallBold">Your pantry is empty</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          Scan raw meat, fish, fruits or veggies to start tracking.
        </ThemedText>
      </View>
      <View style={styles.emptyActions}>
        <Button title="Scan now" icon="scan" size="small" onPress={() => openScanner()} />
        <Button title="Try with sample items" size="small" variant="soft" onPress={onSample} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  summary: { padding: Spacing.four - 4, gap: Spacing.two },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cards: { gap: Spacing.three },
  useCard: { width: 150, padding: Spacing.two, gap: Spacing.one },
  thumb: {
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  thumbPill: { position: 'absolute', top: 8, left: 8 },
  recipeArt: { height: 150, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  recipeUses: { position: 'absolute', left: 10, bottom: 10 },
  recipeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.one },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  scanIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 3 },
  emptyCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three - 4 },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, width: '100%' },
  watch: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
});
