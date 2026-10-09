import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pill, StagePill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { BotBubble, BotTurn, Note, PhotoBubble, PhotoGrid, TimeDivider, TipList, UserBubble } from '@/components/chat';
import { Chips } from '@/components/chips';
import { BatchScan } from '@/components/scan-batch';
import { BOUGHT, PURCHASES, ScanHeader, STORAGES, windowLead, windowText, type Msg, type Scan } from '@/components/scan-shared';
import { ChoicePills, Stepper } from '@/components/controls';
import { TAB_BAR_CLEARANCE } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { addScan } from '@/db/history';
import { addPantryItem, listActivePantry, setPantryStatus, type PantryItem } from '@/db/pantry';
import { getProfile } from '@/db/profile';
import { loadThread, saveThread } from '@/db/scan-thread';
import { estimateCookBy, toIsoDate } from '@/domain/cook-by';
import { peso } from '@/domain/prices';
import { DEFAULT_PROFILE, recommend } from '@/domain/recipes';
import { STORAGE_LABEL, UNIT_LABEL, type Purchase, type Stage, type Storage } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { markScanChatOpen, openScanner } from '@/lib/open-scanner';
import { FISH_SPECIES, isGenericFish } from '@/domain/fish';
import { analyzePhoto, DEMO_MODE, shortError, type Analysis } from '@/ml/classifier';
import { gateMessage } from '@/ml/gate';
import { itemChoices, MSG, RETAKE_TIPS, type Tip } from '@/ml/messages';
import { QUALITY_MESSAGE } from '@/ml/quality';
import { freshnessFor, type Item, type ItemRead, type Verdict } from '@/ml/read';

/** Icons for the photo-quality tips (S10), which are plain strings. */
function qualityTips(tips: string[]): Tip[] {
  return tips.map((text) => ({
    text,
    icon: /light|sun|flash|glare|bright/i.test(text) ? 'sunny-outline' : /steady|focus/i.test(text) ? 'hand-left-outline' : 'scan-outline',
  }));
}

// Includes the fish species chosen after a "fish" result.
const TYPE_IT = '__type';

const MEAT_OR_FISH = new Set(['fish', 'bangus', 'tilapia', 'galunggong', 'pork', 'chicken', 'beef']);

const STORAGE_TIP: Record<Storage, string> = {
  ref: "Keep it in the coldest part of the ref, covered. Freeze it if you won't cook it in time.",
  freezer: 'Seal it in a bag to avoid freezer burn. Thaw it in the ref before cooking.',
  counter: 'Keep it cool and dry, out of direct sun.',
};

type Step =
  | 'checking'
  | 'confirm'
  | 'retake'
  | 'invalid'
  | 'species'
  | 'storage'
  | 'purchase'
  | 'result'
  | 'spoiled'
  | 'recipes'
  | 'done';

/** Where the stage came from, in words (no percentages). */
function scanFindingDetail(scan: Scan) {
  return scan.view ? 'From your photo · eyes and gills' : 'From your photo';
}

/**
 * Module 1: Freshness Scanner (S01, S04b–S06, S08–S16b). Runs fully offline.
 * One messenger-style thread: the Scan button opens the camera (src/lib/open-scanner.ts)
 * and lands here with ?photos=<JSON list of uris>, which adds a new turn at the bottom.
 * Earlier turns stay as plain messages, and the thread is saved on the phone.
 */
export default function ScanScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { photos: raw } = useLocalSearchParams<{ photos?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  /** Finished turns, as plain messages; null until loaded. */
  const [history, setHistory] = useState<Msg[] | null>(null);
  /** The scan in progress, with its buttons. */
  const [live, setLive] = useState<{ key: string; photos: string[] } | null>(null);
  /** The live turn's messages so far, saved with the thread and folded into history when the next scan starts. */
  const liveMsgs = useRef<Msg[]>([]);
  const lastPhotos = useRef<string | null>(null);

  useEffect(markScanChatOpen, []);

  useEffect(() => {
    loadThread<Msg>(db).then((t) => {
      lastPhotos.current = t.lastPhotos;
      setHistory(t.messages);
    });
  }, [db]);

  const persist = (messages: Msg[]) => saveThread(db, { messages, lastPhotos: lastPhotos.current }).catch(() => {});

  // New photos: close the current turn into the history, start a new one.
  useEffect(() => {
    if (history === null || !raw || raw === lastPhotos.current) return;
    const photos = parsePhotos(raw);
    if (photos.length === 0) return;
    lastPhotos.current = raw;
    const closed = [...history, ...liveMsgs.current];
    liveMsgs.current = [];
    setHistory(closed);
    setLive({ key: `${raw}-${Date.now()}`, photos });
    persist(closed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per new photos param
  }, [raw, history === null]);

  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  // Stable, so a turn's effect runs only when its own messages change.
  const onTurnChange = useCallback(
    (msgs: Msg[]) => {
      liveMsgs.current = msgs;
      if (historyRef.current) saveThread(db, { messages: [...historyRef.current, ...msgs], lastPhotos: lastPhotos.current }).catch(() => {});
    },
    [db],
  );

  function clear() {
    Alert.alert('Clear this chat?', 'Your pantry and scan history stay. Only the chat messages are removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          liveMsgs.current = [];
          setLive(null);
          setHistory([]);
          persist([]);
        },
      },
    ]);
  }

  const empty = history !== null && history.length === 0 && !live;
  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScanHeader onClear={empty ? undefined : clear} />
      <ScrollView
        ref={scrollRef}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chat}>
        {DEMO_MODE && (
          <Note icon="flask-outline" tone="amber">
            {"Demo mode: Expo Go can't run the on-device model, so results are sample guesses."}
          </Note>
        )}
        {empty && <Welcome onCamera={() => openScanner('camera')} onGallery={() => openScanner('gallery')} />}
        {history?.map((m, i) => (
          <Message key={i} msg={m} />
        ))}
        {/* UC-1.2: several photos get one progress card and a confirm list. */}
        {live &&
          (live.photos.length > 1 ? (
            <BatchScan key={live.key} photos={live.photos} onChange={onTurnChange} />
          ) : (
            <ScanTurn key={live.key} photo={live.photos[0]} onChange={onTurnChange} />
          ))}
        {!live && !empty && history !== null && (
          <View style={[styles.indent, styles.actions]}>
            <Button title="Take a photo" icon="scan" size="small" onPress={() => openScanner('camera')} />
            <Button title="Choose from gallery" size="small" variant="secondary" onPress={() => openScanner('gallery')} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function parsePhotos(raw?: string): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

/** One single-photo scan in the thread (S04b–S16b): its messages plus the buttons for the next answer. */
function ScanTurn({ photo, onChange }: { photo: string; onChange: (msgs: Msg[]) => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const started = useRef(false);
  const [messages, setMessages] = useState<Msg[]>(() => [
    { kind: 'divider', at: Date.now() },
    { kind: 'photo', uri: photo },
  ]);
  const [step, setStep] = useState<Step>('checking');
  useEffect(() => onChange(messages), [messages, onChange]);
  const [scan, setScan] = useState<Scan | null>(null);
  /** The model's reading of this photo, kept until the user confirms the item. */
  const [reading, setReading] = useState<{ items: ItemRead[]; verdict: Verdict } | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('pc');

  const say = (...msgs: Msg[]) => setMessages((m) => [...m, ...msgs]);
  /** Why the scan stopped: picks the buttons (S10, S12, S13, S14c). */
  const [invalid, setInvalid] = useState<'quality' | 'not_food' | 'face' | 'retry' | null>(null);

  function handleAnalysis(a: Analysis) {
    if (a.kind === 'quality') {
      // UC-1.5 (S10): too dark, washed out or blurry
      const m = QUALITY_MESSAGE[a.issue];
      say(
        { kind: 'bot', text: m.text },
        { kind: 'tips', tips: qualityTips(m.tips) },
        { kind: 'footnote', text: 'Checked on your phone before scanning, so no time is wasted.' },
      );
      setInvalid('quality');
      setStep('invalid');
      return;
    }
    if (a.kind === 'face') {
      // UC-1.9 (S13): a selfie or a photo of someone
      say(
        { kind: 'bot', text: MSG.face },
        { kind: 'footnote', text: "Faces are found on your phone before the food check runs. This photo can't be used." },
      );
      setInvalid('face');
      setStep('invalid');
      return;
    }
    if (a.kind === 'not_food') {
      // UC-1.7 (S12): animals, objects, produce, cooked food
      say({ kind: 'bot', text: `${gateMessage(a.reject)} ${MSG.tryRaw}` });
      setInvalid('not_food');
      setStep('invalid');
      return;
    }
    console.log('Scan reading', a.verdict, a.guesses);
    setReading({ items: a.items, verdict: a.verdict });
    if (a.verdict.confident) {
      // UC-1.10 (S14): name the item, but let the user confirm it (beef vs pork mix-ups)
      say({ kind: 'bot', text: MSG.looksLike(a.verdict.best.item) });
      setStep('confirm');
    } else {
      // UC-1.10 (S14b): unsure, so ask for another photo instead of guessing
      say({ kind: 'bot', text: MSG.unsure });
      setInvalid('retry');
      setStep('invalid');
    }
  }

  /** The user said what the photo shows (confirming the model's item, or correcting it). */
  function answerItem(choice: Item | 'none') {
    say({ kind: 'user', text: choice === 'none' ? 'No' : `Yes, ${choice}` });
    if (choice === 'none') {
      // Not what the model said: try another photo (a loop until the user says yes).
      say({ kind: 'bot', text: MSG.notIt });
      setInvalid('retry');
      setStep('invalid');
      return;
    }
    if (!reading) return;
    const fresh = freshnessFor(reading.items, choice, reading.verdict);
    const view = choice === 'fish' ? (reading.items.find((i) => i.item === 'fish')?.view ?? null) : null;
    if (fresh === 'unclear') {
      // UC-1.11 (S15, S09b): can't settle freshness from the photo, so retake a close-up; never guess.
      say(
        { kind: 'bot', text: MSG.retake(choice) },
        { kind: 'tips', title: choice === 'fish' ? 'For a clear check' : undefined, tips: RETAKE_TIPS[choice === 'fish' ? 'fish' : 'meat'] },
      );
      setStep('retake');
      return;
    }
    identify(photo, choice, fresh, false, view);
  }

  function scanFailed(e: Error) {
    console.warn('Scan failed', e);
    say({ kind: 'bot', text: `Sorry, I couldn't check that photo. Please try again. (${shortError(e)})` });
    setStep('done');
  }

  useEffect(() => {
    // Guard against React running effects twice in development.
    if (started.current) return;
    started.current = true;
    analyzePhoto(photo).then(handleAnalysis, scanFailed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per photo
  }, [photo]);

  /** "Done": the turn ends and stays in the thread; the next photo starts a new turn. */
  function restart() {
    setStep('done');
  }

  function identify(
    uri: string,
    item: string,
    stage: Stage | null,
    typedIn: boolean,
    view: 'eye' | 'gill' | null = null,
  ) {
    const next: Scan = { photo: uri, item, stage: stage ?? 'good', typedIn, view };
    setScan(next);
    // A spoiled result shows the item on its own warning card (S11).
    if (next.stage !== 'spoiled') say({ kind: 'identified', scan: next });
    // The model can't tell fish species apart; price and shelf life need it.
    if (isGenericFish(item)) {
      say({ kind: 'bot', text: 'Which fish is it?' });
      setStep('species');
      return;
    }
    afterIdentified(next);
  }

  function answerSpecies(species: string) {
    if (!scan) return;
    if (species === TYPE_IT) return setTyping(true);
    const next: Scan = { ...scan, item: species };
    setScan(next);
    say({ kind: 'user', text: FISH_SPECIES.find((f) => f.value === species)?.label ?? species });
    afterIdentified(next);
  }

  /** S09: a fish not on the list uses the general fish shelf life, with low confidence. */
  function typedSpecies() {
    const name = typed.trim().toLowerCase();
    if (!scan || !name) return;
    const next: Scan = { ...scan, item: name, rulesKey: 'fish', typedIn: true };
    setScan(next);
    setTyping(false);
    setTyped('');
    say({ kind: 'user', text: typed.trim() });
    afterIdentified(next);
  }

  function afterIdentified(next: Scan) {
    if (next.stage === 'spoiled') {
      // UC-1.6
      say({ kind: 'spoiled', scan: next });
      setStep('spoiled');
    } else {
      say({ kind: 'bot', text: 'Where is it stored?' });
      setStep('storage');
    }
  }

  function answerStorage(storage: Storage) {
    if (!scan) return;
    setScan({ ...scan, storage });
    say({ kind: 'user', text: STORAGE_LABEL[storage] }, { kind: 'bot', text: 'Got it. When did you buy it?' });
    setStep('purchase');
  }

  function answerPurchase(purchase: Purchase) {
    if (!scan?.storage) return;
    const estimate = estimateCookBy(scan.rulesKey ?? scan.item, scan.storage, scan.stage, purchase);
    // A typed-in item uses general shelf life, so confidence is low (UC-1.4).
    if (scan.typedIn) estimate.confidence = 'low';
    const done: Scan = { ...scan, purchase, estimate };
    setScan(done);
    const label = PURCHASES.find((p) => p.value === purchase)?.label ?? purchase;
    if (estimate.safety === 'past_window') {
      // Storage and time say it's unsafe even if the photo looks fine: never "cook today".
      say({ kind: 'user', text: label }, { kind: 'pastWindow', scan: done });
      setStep('spoiled');
      return;
    }
    say({ kind: 'user', text: label }, { kind: 'result', scan: done });
    setStep('result');
  }

  /**
   * R01 (UC-3.1, 3.2): the user's answer, then the dishes picked for this item, in the chat.
   * The scanned item counts as in the pantry even before it's added.
   */
  async function showDishes(answer: string, next: Step) {
    if (!scan) return;
    say({ kind: 'user', text: answer });
    setStep(next);
    const [pantry, profile] = await Promise.all([listActivePantry(db), getProfile(db)]);
    const item = scan.item;
    const withScan: PantryItem[] = pantry.some((p) => p.name === item)
      ? pantry
      : [
          ...pantry,
          {
            id: 'scan', name: item, category: null, quantity, unit, storage: scan.storage ?? 'ref', stage: scan.stage,
            confidence: scan.estimate?.confidence ?? 'medium', purchase: scan.purchase ?? 'today',
            date_added: toIsoDate(new Date()), added_at: Date.now(),
            cook_by: toIsoDate(scan.estimate?.cookBy ? new Date(scan.estimate.cookBy) : new Date()),
            rescan_tomorrow: 0, scan_count: 1, thumbnail_uri: scan.photo, paid_price_php: null, status: 'active', finish_note: null,
          },
        ];
    const { matches } = recommend(withScan, profile ?? DEFAULT_PROFILE, item, 3);
    say({ kind: 'dishes', item, dishes: matches.map((r) => ({ id: r.id, title: r.title, minutes: r.minutes, cost: r.cost })) });
  }

  async function save(asWasted: boolean) {
    if (!scan) return;
    const estimate = scan.estimate ?? estimateCookBy(scan.rulesKey ?? scan.item, 'ref', scan.stage, 'not_sure');
    const id = await addPantryItem(db, {
      name: scan.item,
      category: null,
      quantity: asWasted ? 1 : quantity,
      unit: asWasted ? 'pc' : unit,
      storage: scan.storage ?? 'ref',
      purchase: scan.purchase,
      stage: scan.stage,
      confidence: estimate.confidence,
      date_added: toIsoDate(new Date()),
      cook_by: toIsoDate(estimate.cookBy),
      rescan_tomorrow: estimate.rescanTomorrow,
      thumbnail_uri: scan.photo,
      paid_price_php: null,
    });
    if (asWasted) await setPantryStatus(db, id, 'wasted', scan.stage === 'spoiled' ? 'looked spoiled' : 'past safe window');
    await addScan(db, [
      {
        name: scan.item,
        stage: scan.stage,
        photo: scan.photo,
        daysLeft: estimate.daysLeft,
        outcome: asWasted ? 'wasted' : 'pantry',
      },
    ]);
    if (asWasted) {
      say({ kind: 'user', text: 'Log as wasted' }, { kind: 'bot', text: 'Logged as wasted. Salamat sa pag-check!' });
      setStep('done');
    } else {
      // R01 (UC-3.1, 3.2): offer dishes once, right after adding.
      say(
        { kind: 'user', text: 'Add to pantry' },
        { kind: 'bot', text: `Added to your pantry. Want some dish recommendations for your ${scan.item}?` },
      );
      setStep('recipes');
    }
  }

  return (
    <>
        {messages.map((m, i) => (
          <Message key={i} msg={m} />
        ))}

        {/* S04b: one photo */}
        {step === 'checking' && (
          <BotTurn>
            <Card style={{ gap: Spacing.two }}>
              <View style={styles.between}>
                <ThemedText type="smallBold">Checking freshness…</ThemedText>
                <ThemedText type="label" themeColor="tintText">
                  1 photo
                </ThemedText>
              </View>
              <View style={styles.row}>
                <View style={[styles.itemThumb, { backgroundColor: theme.highlight }]}>
                  {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                </View>
                <View style={{ flex: 1 }} />
                <ActivityIndicator size="small" color={theme.fresh} />
                <ThemedText type="label" themeColor="fresh">
                  Checking
                </ThemedText>
              </View>
            </Card>
            <View style={styles.row}>
              <Ionicons name="lock-closed-outline" size={12} color={theme.textSecondary} />
              <ThemedText type="caption" themeColor="textSecondary">
                Running on your phone · no internet needed
              </ThemedText>
            </View>
          </BotTurn>
        )}

        {/* UC-1.10 (S14, S14b): the user confirms or names the item; the model never decides alone */}
        {step === 'confirm' && reading && (
          <View style={styles.indent}>
            <Chips options={itemChoices(reading.verdict.best.item)} onPick={answerItem} />
            <ThemedText type="caption" themeColor="textSecondary">
              {MSG.confirmHint}
            </ThemedText>
          </View>
        )}
        {/* UC-1.11 (S15, S09b) */}
        {step === 'retake' && (
          <View style={styles.indent}>
            <Button title="Retake close-up" icon="scan" onPress={() => openScanner('camera')} />
          </View>
        )}

        {/* S05a / S09: which fish; the model can't tell species apart */}
        {step === 'species' && (
          <View style={styles.indent}>
            {typing ? (
              <View style={styles.row}>
                <TextInput
                  autoFocus
                  value={typed}
                  onChangeText={setTyped}
                  onSubmitEditing={typedSpecies}
                  placeholder="e.g. tamban"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                  style={[styles.input, { borderColor: theme.tint, color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <Button title="Use this" size="small" onPress={typedSpecies} />
              </View>
            ) : (
              <Chips options={[...FISH_SPECIES, { value: TYPE_IT, label: 'None of these, type it in' }]} onPick={answerSpecies} />
            )}
            <ThemedText type="caption" themeColor="textSecondary">
              Not on my list? I&apos;ll use the general fish shelf life and mark it Low confidence.
            </ThemedText>
          </View>
        )}
        {step === 'storage' && (
          <View style={styles.indent}>
            <Chips options={STORAGES} onPick={answerStorage} />
          </View>
        )}
        {step === 'purchase' && (
          <View style={styles.indent}>
            <Chips options={PURCHASES} onPick={answerPurchase} />
          </View>
        )}
        {step === 'result' && (
          <View style={[styles.indent, styles.actions]}>
            {/* P04 / UC-2.1: how much to add */}
            <Card style={styles.qtyCard}>
              <ThemedText type="label">How much?</ThemedText>
              <View style={styles.row}>
                <Stepper
                  value={quantity}
                  onChange={setQuantity}
                  min={unit === 'g' ? 50 : unit === 'kg' ? 0.25 : 1}
                  step={unit === 'g' ? 50 : unit === 'kg' ? 0.25 : 1}
                  max={unit === 'g' ? 10000 : 999}
                />
                <ChoicePills
                  options={['pc', 'kg', 'g'].map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
                  value={unit}
                  onChange={(u) => {
                    setUnit(u);
                    setQuantity(u === 'g' ? 250 : 1);
                  }}
                />
              </View>
            </Card>
            <Button title="Add to pantry" size="small" onPress={() => save(false)} />
            <Button title="Dish recommendations" size="small" variant="secondary" onPress={() => showDishes('Dish recommendations', 'result')} />
            <Button title="Done" size="small" variant="secondary" onPress={restart} />
          </View>
        )}
        {step === 'spoiled' && (
          <View style={[styles.indent, styles.actions]}>
            <Button title="Log as wasted" size="small" variant="secondary" onPress={() => save(true)} />
            <Button title="Done" size="small" onPress={restart} />
          </View>
        )}
        {step === 'recipes' && (
          <View style={styles.indent}>
            <View style={styles.actions}>
              <Button title="Yes, show me" size="small" onPress={() => showDishes('Yes, show me', 'done')} />
              <Button
                title="No thanks"
                size="small"
                variant="secondary"
                onPress={() => {
                  say({ kind: 'user', text: 'No thanks' });
                  setStep('done');
                }}
              />
            </View>
          </View>
        )}
        {step === 'invalid' && (
          <View style={[styles.indent, styles.actions]}>
            {invalid === 'not_food' || invalid === 'retry' ? (
              <>
                <Button title="Take a photo" size="small" onPress={() => openScanner('camera')} />
                <Button title="Choose from gallery" size="small" variant="secondary" onPress={() => openScanner('gallery')} />
              </>
            ) : (
              <Button title="Retake photo" size="small" onPress={() => openScanner('camera')} />
            )}
            {invalid === 'quality' && (
              <Button title="Choose another" size="small" variant="secondary" onPress={() => openScanner('gallery')} />
            )}
          </View>
        )}
        {step === 'done' && (
          <View style={[styles.indent, styles.actions]}>
            <Button title="Take a photo" icon="scan" size="small" onPress={() => openScanner('camera')} />
            <Button title="Choose from gallery" size="small" variant="secondary" onPress={() => openScanner('gallery')} />
          </View>
        )}
    </>
  );
}

function Welcome({ onCamera, onGallery }: { onCamera: () => void; onGallery: () => void }) {
  const theme = useTheme();
  const tips: [keyof typeof Ionicons.glyphMap, string][] = [
    ['bulb-outline', 'Use good light, no harsh shadows'],
    ['scan-outline', 'One item per photo, filling the frame'],
    ['fish-outline', 'For fish, show the eye and gills'],
  ];
  return (
    <BotTurn>
      <BotBubble>
        {"Hi! Snap or pick a photo of raw beef, pork, chicken or fish. I'll check how fresh it is, right here on your phone."}
      </BotBubble>
      <BotBubble>
        <ThemedText type="label">For the best result</ThemedText>
        {tips.map(([icon, text]) => (
          <View key={text} style={styles.row}>
            <Ionicons name={icon} size={14} color={theme.tint} />
            <ThemedText type="caption">{text}</ThemedText>
          </View>
        ))}
      </BotBubble>
      <View style={styles.actions}>
        <Button title="Take a photo" size="small" onPress={onCamera} />
        <Button title="Choose from gallery" size="small" variant="secondary" onPress={onGallery} />
      </View>
      <View style={styles.row}>
        <Ionicons name="lock-closed-outline" size={12} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary">
          Photos stay on your phone
        </ThemedText>
      </View>
    </BotTurn>
  );
}

function ItemRow({ scan, detail, pill }: { scan: Scan; detail: string; pill?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.itemThumb, { backgroundColor: theme.highlight }]}>
        {scan.photo ? <Image source={{ uri: scan.photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold" style={styles.capitalize}>
          {scan.item}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      {pill ?? <StagePill stage={scan.stage} />}
    </View>
  );
}

export function Message({ msg }: { msg: Msg }) {
  switch (msg.kind) {
    case 'divider':
      return <TimeDivider at={msg.at} />;
    case 'photos':
      return <PhotoGrid uris={msg.uris} />;
    case 'dishes':
      return <DishesCard item={msg.item} dishes={msg.dishes} />;
    case 'photo':
      return <PhotoBubble uri={msg.uri} />;
    case 'user':
      return <UserBubble text={msg.text} />;
    case 'tips':
      return (
        <BotTurn>
          <TipList title={msg.title} tips={msg.tips} />
        </BotTurn>
      );
    case 'footnote':
      return (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.indent}>
          {msg.text}
        </ThemedText>
      );
    case 'bot':
      return (
        <BotTurn>
          <BotBubble>{msg.text}</BotBubble>
        </BotTurn>
      );
    case 'identified':
      return (
        <BotTurn>
          <Card>
            <ItemRow scan={msg.scan} detail={scanFindingDetail(msg.scan)} />
            <ThemedText type="caption" themeColor="textSecondary">
              {MSG.disclaimer}
            </ThemedText>
          </Card>
        </BotTurn>
      );
    case 'spoiled':
      return (
        <BotTurn>
          <Card>
            <ItemRow scan={msg.scan} detail={scanFindingDetail(msg.scan)} />
            <Note icon="warning-outline" tone="danger">
              <ThemedText type="smallBold" themeColor="danger">
                {"This looks spoiled. Don't cook or eat it"}
              </ThemedText>
              <ThemedText type="caption" themeColor="danger">
                {'Watch for a sour smell, a slimy surface, or gray or green spots. When in doubt, throw it out.'}
              </ThemedText>
            </Note>
            <Note icon="trash-outline" tone="neutral">
              Seal it in a bag before throwing it out. Wash anything it touched in the ref.
            </Note>
          </Card>
          <ThemedText type="caption" themeColor="textSecondary">
            No dish suggestions are offered for spoiled food.
          </ThemedText>
        </BotTurn>
      );
    case 'pastWindow':
      return <PastWindowCard scan={msg.scan} />;
    case 'result':
      return <ResultCard scan={msg.scan} />;
  }
}

/** R01 in the chat: the dishes picked for the scanned item, and a link to all of them. */
function DishesCard({ item, dishes }: { item: string; dishes: Extract<Msg, { kind: 'dishes' }>['dishes'] }) {
  const theme = useTheme();
  return (
    <BotTurn>
      <BotBubble>
        {dishes.length > 0
          ? `Here ${dishes.length === 1 ? 'is a dish' : `are ${dishes.length} dishes`} you can cook with your ${item}:`
          : `I couldn't find a dish with ${item} that fits your household right now.`}
      </BotBubble>
      {dishes.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
          {dishes.map((d, n) => (
            <Pressable
              key={d.id}
              onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: d.id } })}
              accessibilityRole="link"
              style={[styles.dish, n > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{d.title}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {d.minutes} min · ≈ {peso(d.cost)}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </Pressable>
          ))}
        </Card>
      )}
      <Pressable
        onPress={() => router.push({ pathname: '/recipes', params: { focus: item } })}
        accessibilityRole="link"
        hitSlop={6}
        style={styles.row}>
        <ThemedText type="label" themeColor="tintText">
          View dishes
        </ThemedText>
        <Ionicons name="arrow-forward" size={14} color={theme.tintText} />
      </Pressable>
    </BotTurn>
  );
}

/** Storage and purchase date put it past the safe window, whatever the photo shows. */
function PastWindowCard({ scan }: { scan: Scan }) {
  const counter = scan.storage === 'counter';
  const when = scan.purchase === 'not_sure' ? 'for an unknown time' : scan.purchase ? BOUGHT[scan.purchase] : '';
  return (
    <BotTurn>
      <Card>
        <ItemRow
          scan={scan}
          detail={`${scan.storage ? STORAGE_LABEL[scan.storage] : ''} · ${scan.purchase ? BOUGHT[scan.purchase] : ''}`}
          pill={<Pill label="Past window" tone={{ fg: 'danger', bg: 'dangerSoft' }} />}
        />
        <Note icon="warning-outline" tone="danger">
          <ThemedText type="smallBold" themeColor="danger">
            {"Past the safe window, don't cook it"}
          </ThemedText>
          <ThemedText type="caption" themeColor="danger">
            {counter
              ? `Raw ${scan.item} left out on the counter ${when} isn't safe, even if it looks fine. Raw meat and fish shouldn't sit out more than 2 hours (1 hour on hot days).`
              : `Raw ${scan.item} ${when} is past how long it usually keeps in the ref, even if it looks fine.`}
          </ThemedText>
        </Note>
        <Note icon="trash-outline" tone="neutral">
          When in doubt, throw it out. Seal it in a bag first so it doesn&apos;t attract pests.
        </Note>
        <ThemedText type="caption" themeColor="textSecondary">
          Bacteria that cause food poisoning often don&apos;t change how food looks or smells.
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {MSG.disclaimer}
        </ThemedText>
      </Card>
      <ThemedText type="caption" themeColor="textSecondary">
        Even if the photo looks fresh, no recipes are offered for this item.
      </ThemedText>
    </BotTurn>
  );
}

/** S06 / S08: suggested cook-by window and tips (UC-1.1, 1.3, 1.8). */
function ResultCard({ scan }: { scan: Scan }) {
  const theme = useTheme();
  const { estimate, storage, purchase } = scan;
  if (!estimate || !storage || !purchase) return null;
  const notSure = purchase === 'not_sure';
  const counterNow = estimate.safety === 'counter_now';
  // Colored by how soon to cook, like the pantry's groups: red today or tomorrow, orange in 2–3 days, green later.
  const tone: { fg: ThemeColor; bg: ThemeColor } =
    counterNow || estimate.daysLeft <= 1
      ? { fg: 'danger', bg: 'dangerSoft' }
      : estimate.daysLeft <= 3
        ? { fg: 'tintText', bg: 'amberSoft' }
        : { fg: 'fresh', bg: 'freshSoft' };
  const confidence = `${estimate.confidence[0].toUpperCase()}${estimate.confidence.slice(1)} confidence`;
  return (
    <BotTurn>
      <Card>
        <ItemRow scan={scan} detail={`${STORAGE_LABEL[storage]} · ${BOUGHT[purchase]}`} />
        <View style={[styles.window, { backgroundColor: theme[tone.bg] }]}>
          <View style={{ flex: 1 }}>
            <ThemedText type="caption" themeColor={tone.fg}>
              {counterNow ? 'Cook or ref it within' : windowLead(estimate.daysLeft, estimate.maxDays, notSure)}
            </ThemedText>
            <ThemedText type="section" themeColor={tone.fg} style={{ fontFamily: Fonts.extraBold }}>
              {counterNow ? '2 hours' : windowText(estimate.daysLeft, estimate.maxDays)}
            </ThemedText>
          </View>
          <Pill label={counterNow ? 'Act now' : confidence} tone={{ fg: 'text', bg: 'backgroundElement' }} />
        </View>
        {notSure && (
          <ThemedText type="caption">
            Based on how it looks, I took the shorter end of the range. You can also freeze it to keep it longer.
          </ThemedText>
        )}
        {counterNow ? (
          <Note icon="warning-outline" tone="amber">
            {`Raw ${scan.item} shouldn't sit out more than 2 hours (1 hour on hot days). Ref it now if you won't cook it soon.`}
          </Note>
        ) : (
          <Note icon="snow-outline" tone="neutral">
            {STORAGE_TIP[storage]}
          </Note>
        )}
        {estimate.rescanTomorrow && (
          <Note icon="notifications-outline" tone="danger">
            I&apos;ll remind you to rescan tomorrow.
          </Note>
        )}
        {/* UC-1.8 */}
        {MEAT_OR_FISH.has(scan.rulesKey ?? scan.item) && !counterNow && (
          <Note icon="water-outline" tone="amber">
            {notSure
              ? 'Give it a quick sniff before cooking.'
              : scan.stage === 'fresh' || scan.stage === 'good'
                ? 'Looks fresh, but check smell and texture before cooking.'
                : 'Check the smell and texture before cooking.'}
          </Note>
        )}
        <ThemedText type="caption" themeColor="textSecondary">
          {MSG.disclaimer}
        </ThemedText>
      </Card>
    </BotTurn>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  chat: { padding: Spacing.three, paddingBottom: TAB_BAR_CLEARANCE, gap: Spacing.three },
  indent: { marginLeft: 34, gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  dish: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2 },
  itemThumb: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden' },
  window: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: Spacing.three - 4, gap: Spacing.two },
  capitalize: { textTransform: 'capitalize' },
  qtyCard: { width: '100%', gap: Spacing.two },
  input: { flex: 1, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14 },
});
