import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Dot, OnDeviceBadge, Pill, STAGE_COLOR, URGENCY_COLOR } from '@/components/badges';
import { BudgetPill } from '@/components/budget';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ItemIcon } from '@/components/item-icon';
import { Fonts, Spacing } from '@/constants/theme';
import { listRecentScans, type ScanRecord } from '@/db/history';
import { listActivePantry, type PantryItem } from '@/db/pantry';
import { getFlag, getProfile, setFlag, type Profile } from '@/db/profile';
import { loadSamplePantry } from '@/db/sample';
import { listFinished, monthRange } from '@/db/savings';
import { budgetFlag, budgetFrom, spentThisWeek, type BudgetFlag } from '@/domain/budget';
import { parseIsoDate, urgencyGroup } from '@/domain/cook-by';
import { pantryValue, peso, priceMonth, priceWatch } from '@/domain/prices';
import { DEFAULT_PROFILE, recommend, type RecipeView } from '@/domain/recipes';
import { summarizeMonth, type MonthSummary } from '@/domain/savings';
import { STORAGE_LABEL, UNIT_LABEL, type Urgency } from '@/domain/types';
import { useFocusQuery } from '@/hooks/use-pantry';
import { getSession } from '@/sync/session';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';

const SCREEN_PAD = Spacing.three + 4; // matches components/screen.tsx
const CARD_GAP = Spacing.three - 4;

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Magandang umaga' : h < 18 ? 'Magandang hapon' : 'Magandang gabi';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function loadHome(db: Parameters<typeof listActivePantry>[0]) {
  const [items, scans, profile, skipped] = await Promise.all([
    listActivePantry(db),
    listRecentScans(db, 2),
    getProfile(db),
    getFlag(db, 'household_setup_skipped'),
  ]);
  const firstLaunch = !(await getFlag(db, 'welcome_seen'));
  const { start, end } = monthRange(0);
  const finished = await listFinished(db, start, end);
  const savings = finished.length > 0 ? summarizeMonth(finished) : null;
  const session = await getSession(db);
  const spent = await spentThisWeek(db);
  const firstName = session?.user.name?.split(' ')[0] || null;
  return { items, scans, profile, offerSetup: !profile && !skipped, firstLaunch, savings, firstName, spent };
}

/** Home: Today dashboard. UC-12.1 first-time user, UC-12.2 returning user. */
export default function HomeScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [{ items, scans, profile, offerSetup, firstLaunch, savings, firstName, spent }, reload] = useFocusQuery(loadHome, {
    items: [] as PantryItem[],
    scans: [] as ScanRecord[],
    profile: null as Profile | null,
    offerSetup: false,
    firstLaunch: false,
    savings: null as MonthSummary | null,
    firstName: null as string | null,
    spent: 0,
  });

  // 02 Welcome on first launch (UC-11.1).
  if (firstLaunch) return <Redirect href="/welcome" />;


  return (
    <Screen>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: Spacing.two }}>
          {firstName ? (
            <View>
              <ThemedText type="small" themeColor="textSecondary">
                {greeting()},
              </ThemedText>
              <ThemedText type="title">{firstName}</ThemedText>
            </View>
          ) : (
            <ThemedText type="title">{greeting()}!</ThemedText>
          )}
          <OnDeviceBadge />
        </View>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityLabel="Account and settings"
          hitSlop={8}
          style={[styles.profileButton, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="person-outline" size={18} color={theme.text} />
        </Pressable>
      </View>
      {offerSetup && (
        <Card style={styles.setupCard}>
          <View style={[styles.scanIcon, { backgroundColor: theme.freshSoft }]}>
            <Ionicons name="home-outline" size={16} color={theme.fresh} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText type="smallBold">Set up your household</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              30 seconds: diet, allergies, how many you cook for.
            </ThemedText>
          </View>
          <View style={styles.setupActions}>
            <Button title="Set up" size="small" onPress={() => router.push('/household/setup')} />
            <Button
              title="Skip"
              size="small"
              variant="secondary"
              onPress={() => setFlag(db, 'household_setup_skipped', '1').then(reload)}
            />
          </View>
        </Card>
      )}
      <Today
        items={items}
        scans={scans}
        profile={profile}
        savings={savings}
        spent={spent}
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
  savings,
  spent,
  onSample,
}: {
  items: PantryItem[];
  scans: ScanRecord[];
  profile: Profile | null;
  savings: MonthSummary | null;
  spent: number;
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
  // Two cards and a peek of the third, so the row reads as swipeable.
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.round((screenWidth - SCREEN_PAD * 2 - CARD_GAP) / 2.25);
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + CARD_GAP}
            decelerationRate="fast"
            style={styles.cardsBleed}
            contentContainerStyle={styles.cards}>
            {urgent.map((item) => (
              <UseTodayCard key={item.id} item={item} width={cardWidth} />
            ))}
          </ScrollView>
        )}
      </View>

      {recipe && (
        <View style={styles.section}>
          <SectionHeader title="Cook before it spoils" link="More dishes" onPress={() => router.push('/recipes')} />
          <RecipeCard recipe={recipe} flag={budgetFlag(recipe.toBuy, budgetFrom(profile?.weekly_budget_php, spent))} />
        </View>
      )}

      {scans.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Recent scans" link="View all" onPress={() => router.navigate('/library')} />
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {scans.map((s, i) => (
              <RecentScanRow key={s.id} scan={s} divider={i > 0} />
            ))}
          </Card>
        </View>
      )}

      {watch && <PriceWatchCard item={watch.item} reason={watch.reason} />}

      {savings && <SavingsCard savings={savings} />}
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
    <View style={[styles.summary, { backgroundColor: theme.summary }]}>
      {/* Decorative bubbles from the FigJam card */}
      <View style={[styles.bubbleTop, { backgroundColor: theme.summaryBubble }]} />
      <View style={[styles.bubbleBottom, { backgroundColor: theme.summaryBubble }]} />
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
    </View>
  );
}

function UseTodayCard({ item, width }: { item: PantryItem; width: number }) {
  const theme = useTheme();
  return (
    <Pressable onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })} accessibilityRole="button">
      <Card style={[styles.useCard, { width }]}>
        <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
          {item.thumbnail_uri ? (
            <Image source={{ uri: item.thumbnail_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <ItemIcon name={item.name} size={36} />
          )}
          <View style={styles.thumbPill}>
            <Pill label="Cook today" tone={{ fg: 'danger', bg: 'dangerSoft' }} />
          </View>
        </View>
        <ThemedText type="smallBold">{capitalize(item.name)}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {item.quantity} {UNIT_LABEL[item.unit] ?? item.unit} · {STORAGE_LABEL[item.storage]}
        </ThemedText>
        {/* UC-2.7 */}
        <Pressable
          onPress={() => router.push({ pathname: '/recipes', params: { focus: item.name } })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cookButton, { backgroundColor: theme.highlight, opacity: pressed ? 0.8 : 1 }]}>
          <ThemedText type="label" themeColor="tintText">
            Cook with this
          </ThemedText>
        </Pressable>
      </Card>
    </Pressable>
  );
}

/** UC-3.1 top pick: the dish that uses the most urgent pantry items. */
function RecipeCard({ recipe, flag }: { recipe: RecipeView; flag: BudgetFlag | null }) {
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
          <View style={styles.metaItem}>
            <ThemedText type="caption" themeColor="textSecondary">
              {recipe.toBuy < 1 ? 'Everything is in your pantry' : `${peso(recipe.toBuy)} to buy · the rest is in your pantry`}
            </ThemedText>
            <BudgetPill flag={flag} />
          </View>
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
    <Pressable
      onPress={() => router.push({ pathname: '/scans/[id]', params: { id: scan.id } })}
      accessibilityRole="button"
      style={[styles.scanRow, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
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
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

/** UC-8.1 teaser: this month's savings, opens the Savings screen. */
function SavingsCard({ savings }: { savings: MonthSummary }) {
  const theme = useTheme();
  const month = new Date().toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  return (
    <Pressable onPress={() => router.push('/savings')} accessibilityRole="button">
      <Card tone="freshSoft" style={styles.watch}>
        <View style={[styles.scanIcon, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="leaf-outline" size={16} color={theme.fresh} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText type="label" themeColor="fresh">
            SAVINGS · {month}
          </ThemedText>
          <ThemedText type="smallBold">
            {peso(savings.saved)} saved · {savings.kgRescued.toFixed(1)} kg rescued
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {savings.wasted > 0 ? `${peso(savings.wasted)} wasted. Tap to see where.` : 'Nothing wasted this month.'}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Card>
    </Pressable>
  );
}

/** UC-4.2: an item priced above its usual range this month. */
function PriceWatchCard({ item, reason }: { item: string; reason: string }) {
  const theme = useTheme();
  return (
    <Pressable onPress={() => router.push('/prices')} accessibilityRole="button">
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
        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
      </Card>
    </Pressable>
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
          Scan raw beef, pork, chicken or fish to start tracking.
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
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  profileButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  setupCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three - 4 },
  setupActions: { flexDirection: 'row', gap: Spacing.two, width: '100%' },
  summary: { borderRadius: 20, padding: Spacing.four - 4, gap: Spacing.two, overflow: 'hidden' },
  bubbleTop: { position: 'absolute', width: 170, height: 170, borderRadius: 85, top: -50, right: -40 },
  bubbleBottom: { position: 'absolute', width: 90, height: 90, borderRadius: 45, bottom: -30, right: 10 },
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
  cardsBleed: { marginHorizontal: -SCREEN_PAD },
  cards: { gap: CARD_GAP, paddingHorizontal: SCREEN_PAD },
  useCard: { padding: Spacing.two, gap: Spacing.one },
  cookButton: { marginTop: Spacing.one, borderRadius: 999, paddingVertical: Spacing.two, alignItems: 'center' },
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
