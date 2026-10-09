import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dot, Pill, StagePill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { BotBubble, BotTurn, Note, PhotoBubble, UserBubble } from '@/components/chat';
import { Chips } from '@/components/chips';
import { ChoicePills, Stepper } from '@/components/controls';
import { TAB_BAR_CLEARANCE } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { addScan } from '@/db/history';
import { addPantryItem, setPantryStatus } from '@/db/pantry';
import { estimateCookBy, toIsoDate, type CookByEstimate } from '@/domain/cook-by';
import { STORAGE_LABEL, UNIT_LABEL, type Purchase, type Stage, type Storage } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';
import { classify, DEMO_MODE, type Guess } from '@/ml/classifier';

const LOW_CONFIDENCE = 0.5;
const MEAT_OR_FISH = new Set(['tilapia', 'bangus', 'galunggong', 'tamban', 'pork', 'chicken', 'beef']);

const STORAGES: { value: Storage; label: string }[] = [
  { value: 'ref', label: 'Ref' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'counter', label: 'Counter' },
];
const PURCHASES: { value: Purchase; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'over_a_week', label: 'Over a week ago' },
  { value: 'not_sure', label: 'Not sure' },
];
const BOUGHT: Record<Purchase, string> = {
  today: 'bought today',
  this_week: 'bought this week',
  over_a_week: 'bought over a week ago',
  not_sure: 'purchase date unknown',
};
const STORAGE_TIP: Record<Storage, string> = {
  ref: "Keep it in the coldest part of the ref, covered. Freeze it if you won't cook it in time.",
  freezer: 'Seal it in a bag to avoid freezer burn. Thaw it in the ref before cooking.',
  counter: 'Keep it cool and dry, out of direct sun.',
};

type Scan = {
  photo: string;
  item: string;
  stage: Stage;
  typedIn: boolean;
  storage?: Storage;
  purchase?: Purchase;
  estimate?: CookByEstimate;
};

type Msg =
  | { kind: 'bot'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'photo'; uri: string }
  | { kind: 'identified'; scan: Scan }
  | { kind: 'result'; scan: Scan }
  | { kind: 'spoiled'; scan: Scan };

type Step =
  | 'start'
  | 'checking'
  | 'pickItem'
  | 'typeItem'
  | 'storage'
  | 'purchase'
  | 'result'
  | 'spoiled'
  | 'recipes'
  | 'done';

function windowText(days: number) {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Today or tomorrow';
  return `Within ${days} days`;
}

/**
 * Module 1: Freshness Scanner (S01, S04–S06, S08, S09, S11). Runs fully offline.
 * The Scan button opens the camera first (src/lib/open-scanner.ts) and lands here
 * with ?photo=<uri>; each new photo remounts a fresh chat.
 */
export default function ScanScreen() {
  const { photo } = useLocalSearchParams<{ photo?: string }>();
  return <ScanChat key={photo ?? 'welcome'} initialPhoto={photo} />;
}

function ScanChat({ initialPhoto }: { initialPhoto?: string }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const started = useRef(false);
  const [messages, setMessages] = useState<Msg[]>(initialPhoto ? [{ kind: 'photo', uri: initialPhoto }] : []);
  const [step, setStep] = useState<Step>(initialPhoto ? 'checking' : 'start');
  const photo = initialPhoto ?? '';
  const [scan, setScan] = useState<Scan | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [typed, setTyped] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('pc');

  const say = (...msgs: Msg[]) => setMessages((m) => [...m, ...msgs]);

  useEffect(() => {
    // Guard against React running effects twice in development.
    if (!initialPhoto || started.current) return;
    started.current = true;
    classify(initialPhoto).then(
      (top) => {
        setGuesses(top);
        if (top[0] && top[0].confidence >= LOW_CONFIDENCE) {
          identify(initialPhoto, top[0].item, top[0].stage, false);
        } else {
          // UC-1.4: not confident, so let the user pick or type the item.
          say({ kind: 'bot', text: "I'm not fully sure which item this is. Is it one of these?" });
          setStep('pickItem');
        }
      },
      (e: Error) => {
        say({ kind: 'bot', text: `Sorry, I couldn't check that photo. (${e.message})` });
        setStep('done');
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per photo
  }, [initialPhoto]);

  function restart() {
    setMessages([]);
    setScan(null);
    setGuesses([]);
    setTyped('');
    setStep('start');
  }

  function identify(uri: string, item: string, stage: Stage | null, typedIn: boolean) {
    // The placeholder model has no freshness stages yet, so assume Good.
    const next: Scan = { photo: uri, item, stage: stage ?? 'good', typedIn };
    setScan(next);
    if (next.stage === 'spoiled') {
      // UC-1.6
      say({ kind: 'identified', scan: next }, { kind: 'spoiled', scan: next });
      setStep('spoiled');
    } else {
      say({ kind: 'identified', scan: next }, { kind: 'bot', text: 'Where is it stored?' });
      setStep('storage');
    }
  }

  function pickItem(item: string, stage: Stage | null, typedIn: boolean) {
    say({ kind: 'user', text: item }, { kind: 'bot', text: `Thanks! Checking it as ${item} now.` });
    identify(photo, item.toLowerCase(), stage, typedIn);
  }

  function answerStorage(storage: Storage) {
    if (!scan) return;
    setScan({ ...scan, storage });
    say({ kind: 'user', text: STORAGE_LABEL[storage] }, { kind: 'bot', text: 'Got it. When did you buy it?' });
    setStep('purchase');
  }

  function answerPurchase(purchase: Purchase) {
    if (!scan?.storage) return;
    const estimate = estimateCookBy(scan.item, scan.storage, scan.stage, purchase);
    // A typed-in item uses general shelf life, so confidence is low (UC-1.4).
    if (scan.typedIn) estimate.confidence = 'low';
    const done: Scan = { ...scan, purchase, estimate };
    setScan(done);
    const label = PURCHASES.find((p) => p.value === purchase)?.label ?? purchase;
    say({ kind: 'user', text: label }, { kind: 'result', scan: done });
    setStep('result');
  }

  async function save(asWasted: boolean) {
    if (!scan) return;
    const estimate = scan.estimate ?? estimateCookBy(scan.item, 'ref', scan.stage, 'not_sure');
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
    if (asWasted) await setPantryStatus(db, id, 'wasted');
    await addScan(db, [{ name: scan.item, stage: scan.stage }]);
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
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="section" style={styles.headerTitle}>
          Freshness Scanner
        </ThemedText>
        <View style={styles.headerSub}>
          <Dot color="fresh" size={6} />
          <ThemedText type="caption" themeColor="fresh">
            On-device · offline ready
          </ThemedText>
        </View>
      </View>

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

        {step === 'start' && <Welcome onCamera={() => openScanner('camera')} onGallery={() => openScanner('gallery')} />}

        {messages.map((m, i) => (
          <Message key={i} msg={m} />
        ))}

        {step === 'checking' && (
          <BotTurn>
            <BotBubble>
              <View style={styles.row}>
                <ActivityIndicator color={theme.tint} />
                <ThemedText type="small">Checking freshness…</ThemedText>
              </View>
              <ThemedText type="caption" themeColor="textSecondary">
                Running on your phone · no internet needed
              </ThemedText>
            </BotBubble>
          </BotTurn>
        )}

        {step === 'pickItem' && (
          <View style={styles.indent}>
            <Card style={styles.radioCard}>
              {guesses.map((g) => (
                <Pressable key={g.label} onPress={() => pickItem(g.item, g.stage, false)} style={styles.radioRow}>
                  <Ionicons name="radio-button-off" size={18} color={theme.textSecondary} />
                  <ThemedText type="smallBold" style={styles.capitalize}>
                    {g.item}
                  </ThemedText>
                </Pressable>
              ))}
            </Card>
            <Pressable onPress={() => setStep('typeItem')} style={[styles.typeRow, { borderColor: theme.backgroundSelected }]}>
              <Ionicons name="pencil-outline" size={14} color={theme.textSecondary} />
              <ThemedText type="caption" themeColor="textSecondary">
                None of these, type it in
              </ThemedText>
            </Pressable>
          </View>
        )}

        {step === 'typeItem' && (
          <View style={[styles.indent, styles.row]}>
            <TextInput
              autoFocus
              value={typed}
              onChangeText={setTyped}
              placeholder="e.g. galunggong"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              onSubmitEditing={() => typed.trim() && pickItem(typed.trim(), null, true)}
              style={[
                styles.input,
                { borderColor: theme.backgroundSelected, color: theme.text, backgroundColor: theme.backgroundElement },
              ]}
            />
            <Button title="OK" size="small" disabled={!typed.trim()} onPress={() => pickItem(typed.trim(), null, true)} />
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
              <Button
                title="Yes, show me"
                size="small"
                onPress={() => {
                  setStep('done');
                  router.push({ pathname: '/recipes', params: { focus: scan?.item } });
                }}
              />
              <Button title="No thanks" size="small" variant="secondary" onPress={() => setStep('done')} />
            </View>
          </View>
        )}
        {step === 'done' && (
          <View style={[styles.indent, styles.actions]}>
            <Button title="Scan another" icon="scan" size="small" onPress={() => openScanner()} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
        {"Hi! Snap or pick a photo of raw meat, fish, fruits or veggies. I'll check how fresh it is, right here on your phone."}
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

function ItemRow({ scan, detail }: { scan: Scan; detail: string }) {
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
      <StagePill stage={scan.stage} />
    </View>
  );
}

function Message({ msg }: { msg: Msg }) {
  switch (msg.kind) {
    case 'photo':
      return <PhotoBubble uri={msg.uri} />;
    case 'user':
      return <UserBubble text={msg.text} />;
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
            <ItemRow scan={msg.scan} detail={msg.scan.typedIn ? 'typed in' : 'identified'} />
          </Card>
        </BotTurn>
      );
    case 'spoiled':
      return (
        <BotTurn>
          <Card>
            <Note icon="warning-outline" tone="danger">
              <ThemedText type="smallBold" themeColor="danger">
                {"Don't cook or eat this"}
              </ThemedText>
              <ThemedText type="caption" themeColor="danger">
                {"Spoilage can spread inside the food, even where you can't see it."}
              </ThemedText>
            </Note>
            <Note icon="leaf-outline" tone="fresh">
              Compost it, or seal it in a bag before throwing it out.
            </Note>
          </Card>
          <ThemedText type="caption" themeColor="textSecondary">
            No dish suggestions are offered for spoiled food.
          </ThemedText>
        </BotTurn>
      );
    case 'result':
      return <ResultCard scan={msg.scan} />;
  }
}

/** S06 / S08: suggested cook-by window and tips (UC-1.1, 1.3, 1.8). */
function ResultCard({ scan }: { scan: Scan }) {
  const theme = useTheme();
  const { estimate, storage, purchase } = scan;
  if (!estimate || !storage || !purchase) return null;
  const notSure = purchase === 'not_sure';
  const confidence = `${estimate.confidence[0].toUpperCase()}${estimate.confidence.slice(1)} confidence`;
  return (
    <BotTurn>
      <Card>
        <ItemRow scan={scan} detail={`${STORAGE_LABEL[storage]} · ${BOUGHT[purchase]}`} />
        <View style={[styles.window, { backgroundColor: theme.dangerSoft }]}>
          <View style={{ flex: 1 }}>
            <ThemedText type="caption" themeColor="danger">
              {notSure ? 'Playing it safe: cook' : 'Suggested: cook within'}
            </ThemedText>
            <ThemedText type="section" themeColor="danger" style={{ fontFamily: Fonts.extraBold }}>
              {windowText(estimate.daysLeft)}
            </ThemedText>
          </View>
          <Pill label={confidence} tone={{ fg: 'text', bg: 'backgroundElement' }} />
        </View>
        {notSure && (
          <ThemedText type="caption">
            Based on how it looks, I took the shorter end of the range. You can also freeze it to keep it longer.
          </ThemedText>
        )}
        <Note icon="snow-outline" tone="neutral">
          {STORAGE_TIP[storage]}
        </Note>
        {estimate.rescanTomorrow && (
          <Note icon="refresh-outline" tone="danger">
            Tagged to rescan tomorrow.
          </Note>
        )}
        {MEAT_OR_FISH.has(scan.item) && (
          <Note icon="water-outline" tone="amber">
            Looks okay, but check the smell and texture before cooking.
          </Note>
        )}
        <ThemedText type="caption" themeColor="textSecondary">
          An estimate, not an official expiry date.
        </ThemedText>
      </Card>
    </BotTurn>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two + 2, borderBottomWidth: 1 },
  headerTitle: { fontSize: 16, lineHeight: 22 },
  headerSub: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chat: { padding: Spacing.three, paddingBottom: TAB_BAR_CLEARANCE, gap: Spacing.three },
  indent: { marginLeft: 34, gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  radioCard: { gap: 0, paddingVertical: Spacing.one },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.two + 2 },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  itemThumb: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden' },
  window: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: Spacing.three - 4, gap: Spacing.two },
  capitalize: { textTransform: 'capitalize' },
  qtyCard: { width: '100%', gap: Spacing.two },
});
