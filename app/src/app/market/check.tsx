import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StagePill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { ChoicePills, Sheet } from '@/components/controls';
import { BoughtSheet, PalengkeHeader, PriceBar, VerdictCard, verdictColor } from '@/components/palengke';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { PRICE_SOURCE } from '@/domain/prices';
import { addCheck, buyFromCheck, listTripChecks, renameStall, type PalengkeCheck } from '@/db/palengke';
import {
  judge,
  REFERENCE_DATE,
  unitShort,
  usualRange,
  variantsOf,
  VENDOR_UNIT_LABEL,
  type Verdict,
  type VendorUnit,
} from '@/domain/palengke';
import type { Stage } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { pickPhoto } from '@/lib/open-scanner';
import { FISH_SPECIES, isGenericFish } from '@/domain/fish';
import { classify, CONFIDENCE_THRESHOLD, DEMO_MODE, describeGuess, type Guess } from '@/ml/classifier';

const UNITS: { value: VendorUnit; label: string }[] = (Object.keys(VENDOR_UNIT_LABEL) as VendorUnit[]).map((value) => ({
  value,
  label: VENDOR_UNIT_LABEL[value],
}));

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Phase = 'identifying' | 'pickItem' | 'species' | 'price' | 'verdict';

/** Palengke check: identify (M02), cut (M03), price, verdict (M04–M08), bought (M09), compare? (M10). */
export default function PalengkeCheckScreen() {
  const { photo } = useLocalSearchParams<{ photo: string }>();
  return <Check key={photo} photo={photo} />;
}

function Check({ photo }: { photo: string }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>('identifying');
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [item, setItem] = useState('');
  const [stage, setStage] = useState<Stage>('good');
  const [note, setNote] = useState<string | null>(null);
  const [cut, setCut] = useState<string | null>(null);
  const [askCut, setAskCut] = useState(false);
  const [priceText, setPriceText] = useState('');
  const [unit, setUnit] = useState<VendorUnit>('kg');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [check, setCheck] = useState<PalengkeCheck | null>(null);
  const [earlier, setEarlier] = useState<PalengkeCheck[]>([]);
  const [stallName, setStallName] = useState('');
  const [comparing, setComparing] = useState(false);
  const [bought, setBought] = useState<{ pantryId: string; daysLeft: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    classify(photo).then(
      (top) => {
        setGuesses(top);
        if (top[0] && top[0].confidence >= CONFIDENCE_THRESHOLD) choose(top[0]);
        else setPhase('pickItem');
      },
      (e: Error) => setError(e.message),
    );
  }, [photo]);

  function choose(g: Guess) {
    const name = g.item;
    setItem(name);
    // Non-fresh fish (eye/gill) isn't a spoilage verdict (see assets/model/README.md), so judge it
    // cautiously as "use soon": never a "good buy", and the note asks for a smell and texture check.
    const nonFreshFish = g.item === 'fish' && g.finding === 'non-fresh';
    setStage(nonFreshFish ? 'use_soon' : (g.stage ?? 'good'));
    setNote(
      nonFreshFish
        ? `Model: ${describeGuess(g)}. Not a spoilage check: smell it and press the flesh before buying.`
        : `Model: ${describeGuess(g)} · ${Math.round(g.confidence * 100)}%`,
    );
    // The model can't tell fish species apart; the reference price needs it.
    if (isGenericFish(name)) return setPhase('species');
    setPhase('price');
    if (variantsOf(name)) setAskCut(true); // UC-6.4
  }

  async function checkPrice() {
    const price = Number(priceText.replace(/[^\d.]/g, ''));
    if (!price) return;
    const v = judge(item, cut, stage, price, unit);
    const trip = await listTripChecks(db, item, cut);
    const stall = `Stall ${trip.length + 1}`;
    const id = await addCheck(db, { item, cut, stage, price, unit, verdict: v.kind, stall, photo_uri: photo });
    setVerdict(v);
    setCheck({ id, created_at: Date.now(), item, cut, stage, price, unit, verdict: v.kind, stall, photo_uri: photo, bought: 0 });
    setPhase('verdict');
    // M10: same item earlier on this trip, in the same unit → offer to compare (UC-6.7).
    const comparable = trip.filter((t) => t.unit === unit && !t.bought);
    if (comparable.length > 0 && stage !== 'spoiled') {
      setEarlier(comparable);
      setStallName(stall);
      setComparing(true);
    }
  }

  async function buy() {
    if (!check) return;
    setBought(await buyFromCheck(db, check));
  }

  async function scanAnother() {
    const next = await pickPhoto();
    if (next) router.replace({ pathname: '/market/check', params: { photo: next } });
  }

  async function compare() {
    if (!check) return;
    const name = stallName.trim();
    if (name && name !== check.stall) await renameStall(db, check.id, name);
    setComparing(false);
    router.replace({ pathname: '/market/compare', params: { item, cut: cut ?? '' } });
  }

  const range = item ? usualRange(item, cut) : null;
  const cutLabel = cut ? variantsOf(item)?.find((v) => v.id === cut)?.label : null;
  const displayName = cutLabel ? `${capitalize(item)} ${cutLabel.toLowerCase()}` : capitalize(item);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <PalengkeHeader title="Palengke check" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {DEMO_MODE && <Note icon="flask-outline" tone="amber">{"Demo mode: Expo Go can't run the on-device model, so results are sample guesses."}</Note>}

        {phase === 'verdict' && verdict && <VerdictCard kind={verdict.kind} title={verdict.title} body={verdict.body} />}

        {phase === 'identifying' && !error && (
          <Card style={styles.centerRow}>
            <ActivityIndicator color={theme.tint} />
            <ThemedText type="small">Checking freshness on your phone…</ThemedText>
          </Card>
        )}
        {error && <Note icon="warning-outline" tone="danger">{`Couldn't check that photo. (${error})`}</Note>}

        {phase === 'pickItem' && (
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            <ThemedText type="small" style={{ paddingVertical: Spacing.two }}>
              Which item is this?
            </ThemedText>
            {guesses.map((g) => (
              <Pressable key={g.label} onPress={() => choose(g)} style={styles.radioRow}>
                <Ionicons name="radio-button-off" size={18} color={theme.textSecondary} />
                <ThemedText type="smallBold">
                  {describeGuess(g)} · {Math.round(g.confidence * 100)}%
                </ThemedText>
              </Pressable>
            ))}
          </Card>
        )}

        {item !== '' && (
          <Card style={styles.itemRow}>
            <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
              <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{displayName}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {[phase === 'verdict' && check ? `1 ${unitShort(unit)}` : null, note ?? 'Identified on-device'].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
            <StagePill stage={stage} />
          </Card>
        )}

        {phase === 'species' && (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="label">Which fish is it?</ThemedText>
            <ChoicePills
              options={FISH_SPECIES}
              value={null}
              onChange={(species) => {
                setItem(species);
                setPhase('price');
              }}
            />
          </View>
        )}

        {phase === 'price' && (
          <>
            {range ? (
              <Card>
                <ThemedText type="caption" themeColor="textSecondary">
                  Usual price this month
                </ThemedText>
                <ThemedText type="title" style={{ fontSize: 22 }}>
                  ₱{range.low}–₱{range.high} per {unitShort(range.unit)}
                </ThemedText>
                <PriceBar range={range} />
                <ThemedText type="caption" themeColor="textSecondary">
                  {PRICE_SOURCE} · as of {REFERENCE_DATE}
                </ThemedText>
              </Card>
            ) : (
              <Note icon="information-circle-outline" tone="neutral">
                {`No reference price for ${item} yet. You'll still get a freshness check.`}
              </Note>
            )}
            <View style={{ gap: Spacing.two }}>
              <ThemedText type="label">{"What's the vendor asking?"}</ThemedText>
              <View style={[styles.priceInput, { borderColor: theme.tint, backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="section" themeColor="textSecondary">
                  ₱
                </ThemedText>
                <TextInput
                  value={priceText}
                  onChangeText={setPriceText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus={!askCut}
                  style={[styles.priceText, { color: theme.text }]}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {VENDOR_UNIT_LABEL[unit]}
                </ThemedText>
              </View>
              <ChoicePills options={UNITS} value={unit} onChange={setUnit} />
            </View>
          </>
        )}

        {phase === 'verdict' && verdict && check && (
          <>
            <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
              <Line label="Vendor price" value={`₱${check.price}/${unitShort(unit)}`} />
              {range && <Line label="Usual this month" value={`₱${range.low}–₱${range.high}/${unitShort(range.unit)}`} divider />}
              <View style={[styles.line, styles.divider, { borderTopColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                  Freshness
                </ThemedText>
                <StagePill stage={stage} />
              </View>
              {range && verdict.band && <PriceBar range={range} price={check.price} color={verdictColor(verdict.kind)} />}
              <ThemedText type="caption" themeColor="textSecondary" style={{ paddingBottom: Spacing.two }}>
                {PRICE_SOURCE} · as of {REFERENCE_DATE}
              </ThemedText>
            </Card>
            {verdict.haggleLine && (
              <Note icon="chatbubble-outline" tone="neutral">
                {verdict.haggleLine}
              </Note>
            )}
            {verdict.unitTip && (
              <Note icon="scale-outline" tone="neutral">
                {verdict.unitTip}
              </Note>
            )}
            {(verdict.kind === 'skip' || verdict.kind === 'dont_buy') && (
              <Note icon="information-circle-outline" tone="neutral">
                {"A spoiled item always gets “Don't buy”, whatever the price."}
              </Note>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {phase === 'price' && <Button title="Check price" onPress={checkPrice} disabled={!Number(priceText.replace(/[^\d.]/g, ''))} />}
        {phase === 'verdict' && verdict && (
          <>
            {verdict.kind === 'skip' || verdict.kind === 'dont_buy' ? (
              <Button title="Scan another" icon="scan" onPress={scanAnother} />
            ) : (
              <Button title="Bought it" icon="checkmark" onPress={buy} />
            )}
            <View style={styles.pair}>
              {verdict.kind === 'skip' ? (
                <View style={{ flex: 1 }}>
                  <Button title="Bought anyway" variant="secondary" onPress={buy} />
                </View>
              ) : verdict.kind !== 'dont_buy' ? (
                <View style={{ flex: 1 }}>
                  <Button title="Scan another" variant="secondary" onPress={scanAnother} />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Button title="Done" variant="secondary" onPress={() => router.back()} />
              </View>
            </View>
          </>
        )}
      </View>

      {/* M03: which cut (UC-6.4) */}
      <Sheet visible={askCut} onClose={() => setAskCut(false)}>
        <CutPicker
          item={item}
          onPick={(c) => {
            setCut(c);
            setAskCut(false);
          }}
        />
      </Sheet>

      {/* M10: compare with your earlier check? (UC-6.7) */}
      <Sheet visible={comparing} onClose={() => setComparing(false)}>
        <View style={styles.compareTitle}>
          <View style={[styles.compareIcon, { backgroundColor: theme.highlight }]}>
            <Ionicons name="swap-vertical" size={18} color={theme.tint} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="section">Compare with your earlier check?</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              Same item, same market trip
            </ThemedText>
          </View>
        </View>
        {earlier.map((e) => (
          <StallRow key={e.id} name={e.stall} detail={`${new Date(e.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ₱${e.price}/${unitShort(e.unit)}`} stage={e.stage} />
        ))}
        {check && <StallRow name="This stall" detail={`Just now · ₱${check.price}/${unitShort(check.unit)}`} stage={check.stage} highlight />}
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="label">Name this stall (optional)</ThemedText>
          <TextInput
            value={stallName}
            onChangeText={setStallName}
            placeholder="e.g. Aling Nena"
            placeholderTextColor={theme.textSecondary}
            style={[styles.nameInput, { borderColor: theme.backgroundSelected, color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </View>
        <Button title="Compare stalls" icon="swap-vertical" onPress={compare} />
        <Pressable onPress={() => setComparing(false)} style={styles.textButton}>
          <ThemedText type="label" themeColor="tintText">
            Just check this one
          </ThemedText>
        </Pressable>
      </Sheet>

      {bought && check && <BoughtSheet check={check} pantryId={bought.pantryId} daysLeft={bought.daysLeft} onScanAnother={scanAnother} />}
    </SafeAreaView>
  );
}

function CutPicker({ item, onPick }: { item: string; onPick: (cut: string | null) => void }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const variants = variantsOf(item) ?? [];
  const general = usualRange(item);
  const options = [
    ...variants.map((v) => ({ id: v.id as string | null, label: v.label, sub: v.sub, range: `₱${v.low}–₱${v.high}/kg` })),
    { id: null, label: 'Not sure', sub: `Use the general ${item} range`, range: general ? `₱${general.low}–₱${general.high}/kg` : '' },
  ];
  return (
    <>
      <View>
        <ThemedText type="section">Which cut is it?</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          Each cut has its own price range.
        </ThemedText>
      </View>
      {options.map((o) => {
        const selected = picked === o.id;
        return (
          <Pressable
            key={o.id ?? 'none'}
            onPress={() => setPicked(o.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.cut, { borderColor: selected ? theme.tint : theme.backgroundSelected, backgroundColor: selected ? theme.highlight : theme.backgroundElement }]}>
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? theme.tint : theme.textSecondary} />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{o.label}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {o.sub}
              </ThemedText>
            </View>
            <ThemedText type="label">{o.range}</ThemedText>
          </Pressable>
        );
      })}
      <Button title="Continue" disabled={picked === undefined} onPress={() => onPick(picked ?? null)} />
    </>
  );
}

function StallRow({ name, detail, stage, highlight }: { name: string; detail: string; stage: Stage; highlight?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.stall, { borderColor: highlight ? theme.tint : theme.backgroundSelected }]}>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      <StagePill stage={stage} />
    </View>
  );
}

function Line({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.line, divider && [styles.divider, { borderTopColor: theme.backgroundSelected }]]}>
      <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing.three + 4, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: Spacing.four },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.two + 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  thumb: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden' },
  priceInput: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  priceText: { flex: 1, fontFamily: Fonts.extraBold, fontSize: 24, paddingVertical: Spacing.one },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2 },
  divider: { borderTopWidth: 1 },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two, gap: Spacing.two },
  pair: { flexDirection: 'row', gap: Spacing.two },
  cut: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, borderWidth: 1, borderRadius: 14, padding: Spacing.three - 4 },
  compareTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  compareIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stall: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 14, padding: Spacing.three - 4 },
  nameInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.medium, fontSize: 14 },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
