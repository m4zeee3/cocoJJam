import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Pill, StagePill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { BotBubble, BotTurn, Note, PhotoGrid, TimeDivider, UserBubble } from '@/components/chat';
import { Chips } from '@/components/chips';
import { BOUGHT, cookLine, PURCHASES, STORAGES, type Msg } from '@/components/scan-shared';
import { TAB_BAR_CLEARANCE } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { addScan, type ScanSummary } from '@/db/history';
import { addPantryItem, setPantryStatus } from '@/db/pantry';
import { estimateCookBy, toIsoDate, type CookByEstimate } from '@/domain/cook-by';
import { FISH_SPECIES } from '@/domain/fish';
import { STAGE_LABEL, STORAGE_LABEL, type Purchase, type Stage, type Storage } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';
import { analyzePhoto, shortError, type Analysis } from '@/ml/classifier';
import { itemChoices, MSG } from '@/ml/messages';
import type { QualityIssue } from '@/ml/quality';
import { freshnessFor, type Item } from '@/ml/read';

type Row = {
  uri: string;
  status: 'waiting' | 'checking' | 'done';
  analysis?: Analysis;
  error?: string;
  /** Confirmed by the user; 'none' = "No, that's not it", skipped until retaken. */
  item?: Item | 'none';
  /** Fish only: bangus, tilapia, galunggong or fish (other). */
  species?: string;
  stage?: Stage;
  /** The photo can't settle freshness (UC-1.11): skipped until it is retaken on its own. */
  unclear?: boolean;
  storage?: Storage;
};

type Phase = 'checking' | 'review' | 'when' | 'storage' | 'purchase' | 'results' | 'saved';

/** S07a: storage and purchase date in one tap, or "Edit per item" for the two questions. */
const WHEN: { value: string; label: string }[] = [
  { value: 'today', label: 'Ref · Today' },
  { value: 'this_week', label: 'Ref · This week' },
  { value: 'edit', label: 'Edit per item' },
];

const QUALITY_SHORT: Record<QualityIssue, string> = { too_dark: 'Too dark', too_bright: 'Too bright', blurry: 'Blurry' };

/** Why a photo can't be checked, or null when it can. */
function problem(r: Row): string | null {
  if (r.error) return "Couldn't check it";
  const a = r.analysis;
  if (!a) return null;
  if (a.kind === 'quality') return QUALITY_SHORT[a.issue];
  if (a.kind === 'face') return 'Has a face in it';
  if (a.kind === 'not_food') return 'Not raw meat or fish';
  if (!a.verdict.confident) return "Can't tell what it is";
  return null;
}

const skipped = (r: Row) => r.status === 'done' && (problem(r) !== null || r.item === 'none' || !!r.unclear);
const ready = (r: Row) => !!r.item && r.item !== 'none' && !!r.stage && (r.item !== 'fish' || !!r.species);
const nameOf = (r: Row) => (r.item === 'fish' ? (r.species ?? 'fish') : (r.item as string));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * UC-1.2 / 1.14 several photos at once: S04 progress card, then one confirm row per photo
 * (S07a, same safe rules as a single scan: the user confirms each item, and a photo that
 * can't settle freshness is skipped with "retake to check"), then storage and purchase
 * date asked once for all, with a per-item storage edit, and one Save (S07).
 */
export function BatchScan({ photos, onChange }: { photos: string[]; onChange: (msgs: Msg[]) => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const started = useRef(false);
  const [startedAt] = useState(() => Date.now());
  const [rows, setRows] = useState<Row[]>(() => photos.map((uri) => ({ uri, status: 'waiting' })));
  const [phase, setPhase] = useState<Phase>('checking');
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [storageAll, setStorageAll] = useState<Storage>('ref');
  const [logWasted, setLogWasted] = useState(true);
  /** Picked a "Ref · Today" chip instead of the two questions. */
  const [quick, setQuick] = useState(false);
  /** S07: answer to "Are these all in the ref?"; 'edit' unlocks the per-item storage switch. */
  const [allInRef, setAllInRef] = useState<'yes' | 'edit' | null>(null);
  const [saved, setSaved] = useState<{ added: number; wasted: number } | null>(null);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...p } : r)));

  // Check the photos one by one, on the phone.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      for (let i = 0; i < photos.length; i++) {
        patch(i, { status: 'checking' });
        try {
          patch(i, { status: 'done', analysis: await analyzePhoto(photos[i]) });
        } catch (e) {
          patch(i, { status: 'done', error: shortError(e) });
        }
      }
      setPhase('review');
    })();
  }, [photos]);

  function answerItem(i: number, choice: Item | 'none') {
    const a = rows[i].analysis;
    if (choice === 'none' || a?.kind !== 'ok') return patch(i, { item: choice, stage: undefined, unclear: false });
    const fresh = freshnessFor(a.items, choice, a.verdict);
    patch(i, { item: choice, species: undefined, stage: fresh === 'unclear' ? undefined : fresh, unclear: fresh === 'unclear' });
  }

  const done = rows.filter((r) => r.status === 'done').length;
  const valid = rows.filter(ready);
  const pending = rows.filter((r) => r.status === 'done' && !skipped(r) && !ready(r)).length;

  function estimate(r: Row): CookByEstimate | null {
    if (!r.storage || !purchase || !r.stage) return null;
    return estimateCookBy(nameOf(r), r.storage, r.stage, purchase);
  }
  const unsafe = (r: Row) => r.stage === 'spoiled' || estimate(r)?.safety === 'past_window';

  function chooseStorage(s: Storage) {
    setStorageAll(s);
    setRows((rs) => rs.map((r) => (ready(r) ? { ...r, storage: s } : r)));
    setPhase('purchase');
  }

  function chooseWhen(v: string) {
    if (v === 'edit') return setPhase('storage');
    setQuick(true);
    setStorageAll('ref');
    setRows((rs) => rs.map((r) => (ready(r) ? { ...r, storage: 'ref' } : r)));
    setPurchase(v as Purchase);
    setPhase('results');
  }

  function cycleStorage(i: number) {
    const order: Storage[] = ['ref', 'freezer', 'counter'];
    const cur = rows[i].storage ?? 'ref';
    patch(i, { storage: order[(order.indexOf(cur) + 1) % order.length] });
  }

  async function save() {
    const history: ScanSummary[] = [];
    let added = 0;
    let wasted = 0;
    for (const r of valid) {
      const e = estimate(r);
      if (!e) continue;
      const bad = unsafe(r);
      if (bad && !logWasted) {
        history.push({ name: nameOf(r), stage: r.stage!, photo: r.uri, daysLeft: e.daysLeft });
        continue;
      }
      const id = await addPantryItem(db, {
        name: nameOf(r),
        category: null,
        quantity: 1,
        unit: 'pc',
        storage: r.storage!,
        purchase: purchase!,
        stage: r.stage!,
        confidence: e.confidence,
        date_added: toIsoDate(new Date()),
        cook_by: toIsoDate(e.cookBy),
        rescan_tomorrow: e.rescanTomorrow,
        thumbnail_uri: r.uri,
        paid_price_php: null,
      });
      if (bad) await setPantryStatus(db, id, 'wasted', r.stage === 'spoiled' ? 'looked spoiled' : 'past safe window');
      if (bad) wasted++;
      else added++;
      history.push({ name: nameOf(r), stage: r.stage!, photo: r.uri, daysLeft: e.daysLeft, outcome: bad ? 'wasted' : 'pantry' });
    }
    if (history.length) await addScan(db, history);
    setSaved({ added, wasted });
    setPhase('saved');
  }

  const unsafeCount = phase === 'results' ? valid.filter(unsafe).length : 0;
  // S07: ask "Are these all in the ref?" when everything was put in the ref.
  const askRef = phase === 'results' && storageAll === 'ref' && allInRef === null;
  const canEdit = phase === 'results' && (storageAll !== 'ref' || allInRef === 'edit');
  const safeCount = valid.length - unsafeCount;
  // S07: most urgent first, unsafe items (not added) last.
  const sorted = rows
    .filter(ready)
    .sort((a, b) => Number(unsafe(a)) - Number(unsafe(b)) || (estimate(a)?.daysLeft ?? 0) - (estimate(b)?.daysLeft ?? 0));

  // What this turn leaves in the thread once the next scan starts: the photos and a summary.
  const summary = (() => {
    if (phase === 'checking') return `Checking ${photos.length} photos…`;
    const lines = rows.map((r, i) => {
      const why = problem(r);
      if (why) return `• Photo ${i + 1}: skipped (${why.toLowerCase()})`;
      if (r.item === 'none' || r.unclear) return `• Photo ${i + 1}: skipped, scan it on its own`;
      if (!ready(r)) return `• Photo ${i + 1}: not confirmed`;
      const e = estimate(r);
      const what = !e ? STAGE_LABEL[r.stage!] : unsafe(r) ? 'not added to pantry' : e.safety === 'counter_now' ? 'cook or ref it within 2 hours' : cookLine(e.daysLeft, e.maxDays).toLowerCase();
      return `• ${cap(nameOf(r))}: ${what}`;
    });
    const done = saved
      ? [saved.added ? `Added ${saved.added} to your pantry.` : null, saved.wasted ? `Logged ${saved.wasted} as wasted.` : null].filter(Boolean).join(' ')
      : null;
    return [`I checked ${photos.length} photos:`, ...lines, done].filter(Boolean).join('\n');
  })();
  useEffect(() => {
    onChange([
      { kind: 'divider', at: startedAt },
      { kind: 'photos', uris: photos },
      { kind: 'bot', text: summary },
    ]);
  }, [summary, photos, onChange, startedAt]);

  return (
    <>
        {/* The user's photos */}
        <TimeDivider at={startedAt} />
        <PhotoGrid uris={photos} />

        {/* S04: progress */}
        <BotTurn>
          <Card style={{ gap: Spacing.two }}>
            <View style={styles.between}>
              <ThemedText type="smallBold">{phase === 'checking' ? 'Checking freshness…' : 'Checked on your phone'}</ThemedText>
              <ThemedText type="label" themeColor="tintText">
                {done} of {photos.length}
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
              <View style={[styles.fill, { backgroundColor: theme.tint, width: `${(done / photos.length) * 100}%` }]} />
            </View>
            {phase === 'checking' &&
              rows.map((r, i) => (
                <View key={i} style={styles.progressRow}>
                  <Thumb uri={r.uri} />
                  <ThemedText type="small" style={{ flex: 1 }}>
                    Photo {i + 1}
                  </ThemedText>
                  <ThemedText
                    type="label"
                    themeColor={r.status === 'done' ? (problem(r) ? 'danger' : 'fresh') : r.status === 'checking' ? 'tintText' : 'textSecondary'}>
                    {r.status === 'done' ? (problem(r) ?? 'Done') : r.status === 'checking' ? 'Checking' : 'Waiting'}
                  </ThemedText>
                </View>
              ))}
            <ThemedText type="caption" themeColor="textSecondary">
              Running on your phone · no internet needed
            </ThemedText>
          </Card>
        </BotTurn>

        {/* Confirm each photo */}
        {phase !== 'checking' && (
          <>
            <BotTurn>
              <BotBubble>
                {pending > 0
                  ? `Checked ${photos.length} photos. Please confirm each one:`
                  : valid.length > 0
                    ? 'All set. You can still change any item.'
                    : "I couldn't check any of these. Try again with one item per photo, in good light."}
              </BotBubble>
            </BotTurn>
            <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
              {rows.map((r, i) => (
                <ReviewRow
                  key={i}
                  row={r}
                  index={i}
                  divider={i > 0}
                  locked={phase === 'results' || phase === 'saved'}
                  onItem={(c) => answerItem(i, c)}
                  onSpecies={(s) => patch(i, { species: s })}
                  onChange={() => patch(i, { item: undefined, species: undefined, stage: undefined, unclear: false })}
                />
              ))}
            </Card>
            {phase === 'review' && pending === 0 && valid.length > 0 && (
              <Button title={`Continue with ${valid.length} item${valid.length === 1 ? '' : 's'}`} size="small" onPress={() => setPhase('when')} />
            )}
            {phase === 'review' && valid.length === 0 && pending === 0 && (
              <Button title="Scan again" icon="scan" size="small" onPress={() => openScanner()} />
            )}
          </>
        )}

        {/* S07a: asked once for all (UC-1.14) */}
        {phase !== 'checking' && phase !== 'review' && (
          <BotTurn>
            <BotBubble>
              {valid.length === 1
                ? 'Where is it stored, and when did you buy it?'
                : "Where are they stored, and when did you buy them? I'll ask once for all."}
            </BotBubble>
          </BotTurn>
        )}
        {phase === 'when' && <Chips options={WHEN} onPick={chooseWhen} />}
        {quick && purchase && <UserBubble text={`Ref · ${PURCHASES.find((p) => p.value === purchase)?.label ?? purchase}`} />}
        {!quick && phase !== 'when' && phase !== 'checking' && phase !== 'review' && <UserBubble text="Edit per item" />}
        {!quick && (phase === 'storage' || phase === 'purchase' || phase === 'results' || phase === 'saved') && (
          <BotTurn>
            <BotBubble>{valid.length === 1 ? 'Where is it stored?' : 'Where are they stored? You can change one item later.'}</BotBubble>
          </BotTurn>
        )}
        {phase === 'storage' && <Chips options={STORAGES} onPick={chooseStorage} />}
        {!quick && (phase === 'purchase' || phase === 'results' || phase === 'saved') && (
          <>
            <UserBubble text={STORAGE_LABEL[storageAll]} />
            <BotTurn>
              <BotBubble>{valid.length === 1 ? 'When did you buy it?' : 'When did you buy them?'}</BotBubble>
            </BotTurn>
          </>
        )}
        {phase === 'purchase' && (
          <Chips
            options={PURCHASES}
            onPick={(p) => {
              setPurchase(p);
              setPhase('results');
            }}
          />
        )}

        {/* Results with a per-item storage edit */}
        {(phase === 'results' || phase === 'saved') && purchase && (
          <>
            {!quick && <UserBubble text={PURCHASES.find((p) => p.value === purchase)?.label ?? purchase} />}
            <BotTurn>
              <BotBubble>{`I checked ${valid.length} item${valid.length === 1 ? '' : 's'}. Most urgent first:`}</BotBubble>
              <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
                {sorted.map((r, n) => {
                  const i = rows.indexOf(r);
                  const e = estimate(r);
                  const bad = unsafe(r);
                  const line = bad
                    ? 'Not added to pantry'
                    : e?.safety === 'counter_now'
                      ? 'Cook or ref it within 2 hours'
                      : cookLine(e?.daysLeft ?? 0, e?.maxDays);
                  return (
                    <View key={i} style={[styles.resultRow, { borderTopColor: theme.backgroundSelected }, n > 0 && styles.divider]}>
                      <Thumb uri={r.uri} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <ThemedText type="smallBold" style={styles.capitalize}>
                          {nameOf(r)}
                        </ThemedText>
                        <ThemedText type="caption" themeColor="danger">
                          {line}
                        </ThemedText>
                        <Pressable
                          onPress={() => canEdit && cycleStorage(i)}
                          disabled={!canEdit}
                          accessibilityLabel="Change storage"
                          style={styles.inline}>
                          <ThemedText type="caption" themeColor="tintText">
                            {STORAGE_LABEL[r.storage ?? 'ref']} · {BOUGHT[purchase]}
                          </ThemedText>
                          {canEdit && <Ionicons name="swap-horizontal" size={12} color={theme.tintText} />}
                        </Pressable>
                      </View>
                      {r.stage !== 'spoiled' && e?.safety === 'past_window' ? (
                        <Pill label="Past window" tone={{ fg: 'danger', bg: 'dangerSoft' }} />
                      ) : (
                        <StagePill stage={r.stage!} />
                      )}
                    </View>
                  );
                })}
              </Card>
              <ThemedText type="caption" themeColor="textSecondary">
                {MSG.disclaimer} Check the smell and texture before cooking.
              </ThemedText>
              {storageAll === 'ref' && (
                <BotBubble>Are these all in the ref? (Freeze anything you won&apos;t cook in the next 2 days.)</BotBubble>
              )}
            </BotTurn>
            {askRef && (
              <Chips
                options={[
                  { value: 'yes', label: 'Yes, all in the ref' },
                  { value: 'edit', label: 'Edit per item' },
                ]}
                onPick={(v) => setAllInRef(v as 'yes' | 'edit')}
              />
            )}
            {allInRef && (
              <UserBubble text={allInRef === 'yes' ? 'Yes, all in the ref' : 'Edit per item (tap a storage to change it)'} />
            )}
          </>
        )}

        {phase === 'results' && !askRef && (
          <View style={{ gap: Spacing.two }}>
            {unsafeCount > 0 && (
              <>
                <Note icon="warning-outline" tone="danger">
                  {`${unsafeCount} item${unsafeCount === 1 ? '' : 's'} may not be safe. Don't cook ${unsafeCount === 1 ? 'it' : 'them'}. When in doubt, throw it out.`}
                </Note>
                <Pressable onPress={() => setLogWasted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: logWasted }} style={styles.inline}>
                  <Ionicons name={logWasted ? 'checkbox' : 'square-outline'} size={20} color={theme.tint} />
                  <ThemedText type="small">{`Log ${unsafeCount} spoiled item${unsafeCount === 1 ? '' : 's'} as wasted`}</ThemedText>
                </Pressable>
              </>
            )}
            <View style={styles.actions}>
              <Button
                title={safeCount > 0 ? `Save ${safeCount} to pantry` : unsafeCount > 0 && logWasted ? 'Log as wasted' : 'Done'}
                size="small"
                onPress={save}
              />
              {safeCount > 0 && (
                <Button title="Dish recommendations" size="small" variant="secondary" onPress={() => router.push('/recipes')} />
              )}
            </View>
          </View>
        )}

        {phase === 'saved' && saved && (
          <>
            <BotTurn>
              <BotBubble>
                {[
                  saved.added ? `Added ${saved.added} to your pantry.` : null,
                  saved.wasted ? `Logged ${saved.wasted} as wasted.` : null,
                  'Salamat sa pag-check!',
                ]
                  .filter(Boolean)
                  .join(' ')}
              </BotBubble>
            </BotTurn>
            <View style={styles.actions}>
              {saved.added > 0 && <Button title="View pantry" size="small" onPress={() => router.navigate('/pantry')} />}
              <Button title="Scan more" icon="scan" size="small" variant="secondary" onPress={() => openScanner()} />
            </View>
          </>
        )}
    </>
  );
}

function ReviewRow({
  row: r,
  index,
  divider,
  locked,
  onItem,
  onSpecies,
  onChange,
}: {
  row: Row;
  index: number;
  divider: boolean;
  locked: boolean;
  onItem: (c: Item | 'none') => void;
  onSpecies: (s: string) => void;
  onChange: () => void;
}) {
  const theme = useTheme();
  const why = problem(r);
  const a = r.analysis?.kind === 'ok' ? r.analysis : null;
  const guess = a?.verdict.confident ? a.verdict.best.item : undefined;

  let title: string;
  let body: ReactNode = null;
  if (why) {
    title = `Photo ${index + 1}: skipped`;
    body = (
      <ThemedText type="caption" themeColor="danger">
        {why}. Scan it on its own to check it.
      </ThemedText>
    );
  } else if (r.item === 'none') {
    title = `Photo ${index + 1}: skipped`;
    body = (
      <ThemedText type="caption" themeColor="textSecondary">
        Not the item I guessed. Scan it on its own to check it.
      </ThemedText>
    );
  } else if (r.unclear && r.item) {
    // UC-1.11: the photo can't settle freshness
    title = cap(r.item);
    body = (
      <ThemedText type="caption" themeColor="textSecondary">
        Photo unclear · retake it up close on its own to check
      </ThemedText>
    );
  } else if (!r.item && guess) {
    title = `Looks like ${guess}. Right?`;
    body = <Chips options={itemChoices(guess)} onPick={onItem} />;
  } else if (r.item === 'fish' && !r.species) {
    title = 'Which fish is it?';
    body = <Chips options={FISH_SPECIES} onPick={onSpecies} />;
  } else {
    title = cap(nameOf(r));
  }

  const complete = ready(r);
  return (
    <View style={[styles.reviewRow, divider && styles.divider, { borderTopColor: theme.backgroundSelected }]}>
      <Thumb uri={r.uri} />
      <View style={{ flex: 1, gap: Spacing.one + 2 }}>
        <View style={styles.between}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {title}
          </ThemedText>
          {complete && <StagePill stage={r.stage!} />}
          {r.unclear && <Pill label="Retake" tone={{ fg: 'textSecondary', bg: 'backgroundSelected' }} />}
          {!complete && !r.unclear && !why && r.item !== 'none' && <Pill label="Confirm" tone={{ fg: 'amber', bg: 'amberSoft' }} />}
        </View>
        {complete && (
          <ThemedText type="caption" themeColor="textSecondary">
            {r.item === 'fish' ? 'From your photo · fish type picked by you' : 'From your photo'}
          </ThemedText>
        )}
        {body}
        {!locked && (complete || r.item === 'none' || r.unclear) && (
          <Pressable onPress={onChange} hitSlop={6}>
            <ThemedText type="label" themeColor="tintText">
              Change
            </ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Thumb({ uri }: { uri: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  chat: { padding: Spacing.three, paddingBottom: TAB_BAR_CLEARANCE, gap: Spacing.three },
  grid: { alignSelf: 'flex-end', width: '62%', flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 16 },
  gridCell: { width: '48.5%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  reviewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three - 4, paddingVertical: Spacing.three - 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.three - 4 },
  divider: { borderTopWidth: 1 },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  capitalize: { textTransform: 'capitalize' },
});
