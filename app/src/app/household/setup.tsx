import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { AllergyStep, BudgetStep, DietStep, SizeStep, StepTitle } from '@/components/household-steps';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ALLERGY_INFO, DIET_INFO, profileTags, saveProfile, setFlag, type Profile } from '@/db/profile';
import { DEFAULT_PROFILE } from '@/domain/recipes';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';

const STEPS = [
  { title: 'Any dietary needs?', body: "Pick all that apply. Recipes that don't fit are hidden." },
  { title: 'Any food allergies?', body: "We'll hide dishes with these ingredients, including hidden ones like bagoong." },
  { title: 'How many are you cooking for?', body: 'Recipes scale servings and cost to your household.' },
  { title: 'Weekly grocery budget?', body: 'Used for your shopping list total and price warnings. Optional.' },
];

/** H01–H05: the 30-second household setup (UC-5.1). */
export default function HouseholdSetupScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [done, setDone] = useState(false);
  const set = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));

  async function skip() {
    // Skipping is remembered so Home stops offering setup; recipes will ask inline instead.
    await setFlag(db, 'household_setup_skipped', '1');
    router.back();
  }

  async function next() {
    if (step < STEPS.length - 1) return setStep(step + 1);
    await saveProfile(db, profile);
    setDone(true);
  }

  if (done) return <AllSet profile={profile} />;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.top}>
        <Pressable
          onPress={() => (step === 0 ? router.back() : setStep(step - 1))}
          accessibilityLabel="Back"
          hitSlop={8}
          style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <Pressable onPress={skip} hitSlop={8}>
          <ThemedText type="label" themeColor="textSecondary">
            Skip for now
          </ThemedText>
        </Pressable>
      </View>
      <View style={styles.progress}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.bar, { backgroundColor: i <= step ? theme.tint : theme.backgroundSelected }]} />
        ))}
      </View>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.stepLabel}>
        Step {step + 1} of {STEPS.length} · Household setup
      </ThemedText>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <StepTitle title={STEPS[step].title} body={STEPS[step].body} />
          {step === 0 && <DietStep value={profile.diets} onChange={(diets) => set({ diets })} />}
          {step === 1 && (
            <AllergyStep
              value={profile.allergies}
              other={profile.otherAllergies}
              onChange={(allergies) => set({ allergies })}
              onOtherChange={(otherAllergies) => set({ otherAllergies })}
            />
          )}
          {step === 2 && <SizeStep value={profile.household_size} onChange={(household_size) => set({ household_size })} />}
          {step === 3 && (
            <>
              <BudgetStep value={profile.weekly_budget_php} onChange={(weekly_budget_php) => set({ weekly_budget_php })} />
              <Card style={{ gap: Spacing.one + 2 }}>
                <ThemedText type="label">Your household</ThemedText>
                {profile.diets.map((d) => (
                  <Summary key={d} icon="ban-outline" text={DIET_INFO[d].label} />
                ))}
                {profile.allergies.map((a) => (
                  <Summary key={a} icon="alert-circle-outline" text={`Allergic to ${ALLERGY_INFO[a].label.toLowerCase()}`} />
                ))}
                {profile.otherAllergies.map((o) => (
                  <Summary key={o} icon="alert-circle-outline" text={`Allergic to ${o}`} />
                ))}
                <Summary icon="people-outline" text={`${profile.household_size} ${profile.household_size === 1 ? 'person' : 'people'}`} />
              </Card>
            </>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <Button title={step === STEPS.length - 1 ? 'Save profile' : 'Continue'} icon={step === STEPS.length - 1 ? 'checkmark' : undefined} onPress={next} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Summary({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.summary}>
      <Ionicons name={icon} size={14} color={theme.textSecondary} />
      <ThemedText type="caption">{text}</ThemedText>
    </View>
  );
}

/** H05: profile saved. */
function AllSet({ profile }: { profile: Profile }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.allSet}>
        <View style={[styles.homeRing, { backgroundColor: theme.freshSoft }]}>
          <View style={[styles.homeIcon, { backgroundColor: theme.fresh }]}>
            <Ionicons name="home-outline" size={26} color="#fff" />
          </View>
        </View>
        <ThemedText type="title">You&apos;re all set</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          I won&apos;t ask these again. You can change them anytime from the profile icon on Home.
        </ThemedText>
        <View style={styles.tags}>
          {profileTags(profile, true).map((t) => (
            <View key={t} style={[styles.tag, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
              <ThemedText type="label">{t}</ThemedText>
            </View>
          ))}
        </View>
        <View style={styles.summary}>
          <Ionicons name="information-circle-outline" size={12} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Saved on this phone · syncs if you sign in
          </ThemedText>
        </View>
      </View>
      <View style={styles.footer}>
        <Button
          title="Start scanning"
          icon="scan"
          onPress={() => {
            router.back();
            openScanner();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: Spacing.one + 2, paddingHorizontal: Spacing.three + 4, marginTop: Spacing.two },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  stepLabel: { paddingHorizontal: Spacing.three + 4, marginTop: Spacing.two },
  content: { padding: Spacing.three + 4, gap: Spacing.four },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  allSet: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  homeRing: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  homeIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
});
