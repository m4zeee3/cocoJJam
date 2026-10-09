import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Sheet, Stepper } from '@/components/controls';
import { AllergyStep, BudgetStep, DietStep, StepTitle } from '@/components/household-steps';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ALLERGY_INFO, DIET_INFO, getProfile, saveProfile, type Profile } from '@/db/profile';
import { peso } from '@/domain/prices';
import { DEFAULT_PROFILE } from '@/domain/recipes';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';

/** H08 edit household (UC-5.4). Loads the profile, then hands it to the form. */
export default function HouseholdScreen() {
  const theme = useTheme();
  const [profile] = useFocusQuery<Profile | null | undefined>(getProfile, undefined);
  if (profile === undefined) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;
  return <EditHousehold initial={profile ?? DEFAULT_PROFILE} isNew={profile === null} />;
}

type Editing = 'diet' | 'allergy' | 'budget' | null;

function EditHousehold({ initial, isNew }: { initial: Profile; isNew: boolean }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const set = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));

  const diets = profile.diets.length ? profile.diets.map((d) => DIET_INFO[d].label).join(', ') : 'No restrictions';
  const allergyList = [...profile.allergies.map((a) => ALLERGY_INFO[a].label), ...profile.otherAllergies.map((o) => o[0].toUpperCase() + o.slice(1))];
  const allergies = allergyList.length ? allergyList.join(', ') : 'None';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <ThemedText type="section">Household</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Used to filter and scale every recommendation.
        </ThemedText>
        <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
          <Row icon="ban-outline" label="Dietary needs" value={diets} onPress={() => setEditing('diet')} />
          <Row icon="alert-circle-outline" label="Allergies" value={allergies} onPress={() => setEditing('allergy')} divider />
          <View style={[styles.row, styles.divider, { borderTopColor: theme.backgroundSelected }]}>
            <RowIcon icon="people-outline" />
            <ThemedText type="small" style={{ flex: 1 }}>
              Household size
            </ThemedText>
            <Stepper value={profile.household_size} onChange={(household_size) => set({ household_size })} min={1} max={20} />
          </View>
          <Row
            icon="wallet-outline"
            label="Weekly budget"
            value={profile.weekly_budget_php ? `${peso(profile.weekly_budget_php)} / week` : 'Not set'}
            onPress={() => setEditing('budget')}
            divider
          />
        </Card>
        <View style={styles.inline}>
          <Ionicons name="phone-portrait-outline" size={12} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Saved on this phone · syncs if you sign in. Changes apply to your next recommendation.
          </ThemedText>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={isNew ? 'Save profile' : 'Save changes'}
          onPress={async () => {
            await saveProfile(db, profile);
            router.back();
          }}
        />
      </View>

      <Sheet visible={editing !== null} onClose={() => setEditing(null)}>
        {editing === 'diet' && (
          <>
            <StepTitle title="Dietary needs" body="Pick all that apply." />
            <DietStep value={profile.diets} onChange={(diets) => set({ diets })} />
          </>
        )}
        {editing === 'allergy' && (
          <>
            <StepTitle title="Allergies" body="Dishes with these ingredients are hidden." />
            <AllergyStep
              value={profile.allergies}
              other={profile.otherAllergies}
              onChange={(allergies) => set({ allergies })}
              onOtherChange={(otherAllergies) => set({ otherAllergies })}
            />
          </>
        )}
        {editing === 'budget' && (
          <>
            <StepTitle title="Weekly grocery budget" body="Optional. Clear it to remove." />
            <BudgetStep value={profile.weekly_budget_php} onChange={(weekly_budget_php) => set({ weekly_budget_php })} />
          </>
        )}
        <Button title="Done" onPress={() => setEditing(null)} />
      </Sheet>
    </SafeAreaView>
  );
}

function RowIcon({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <View style={[styles.rowIcon, { backgroundColor: theme.background }]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  divider,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onPress: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, divider && [styles.divider, { borderTopColor: theme.backgroundSelected }]]}>
      <RowIcon icon={icon} />
      <View style={{ flex: 1 }}>
        <ThemedText type="caption" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="smallBold">{value}</ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.three - 4 },
  divider: { borderTopWidth: 1 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two },
});
