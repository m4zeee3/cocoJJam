import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { OtherInput } from '@/components/household-steps';
import { Sheet, Stepper } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { ALLERGY_INFO, DIET_INFO, type Allergy, type Diet, type Profile } from '@/db/profile';
import { useTheme } from '@/hooks/use-theme';

/** Multi-select pills with a "None" pill that clears the rest. */
function MultiPills<T extends string>({
  options,
  value,
  onChange,
  other,
  onOtherToggle,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  /** Whether "Other" (type it in) is on. */
  other: boolean;
  onOtherToggle: (on: boolean) => void;
}) {
  const theme = useTheme();
  const all: { value: T | 'other' | null; label: string }[] = [{ value: null, label: 'None' }, ...options, { value: 'other', label: 'Other' }];
  return (
    <View style={styles.pills}>
      {all.map((o) => {
        const selected =
          o.value === null ? value.length === 0 && !other : o.value === 'other' ? other : value.includes(o.value as T);
        return (
          <Pressable
            key={o.value ?? 'none'}
            onPress={() => {
              if (o.value === null) {
                onOtherToggle(false);
                return onChange([]);
              }
              if (o.value === 'other') return onOtherToggle(!other);
              const v = o.value as T;
              onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            style={[
              styles.pill,
              { borderColor: selected ? theme.tint : theme.backgroundSelected, backgroundColor: selected ? theme.highlight : theme.backgroundElement },
            ]}>
            {selected && o.value !== null && <Ionicons name="checkmark" size={12} color={theme.tintText} />}
            <ThemedText type="label" themeColor={selected ? 'tintText' : 'text'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * R02 (UC-3.1, 5.1): diet, allergies and servings before showing dishes.
 * `mealOnly` opens it as H07's one-time change (UC-5.3), unticked by default.
 */
export function QuickQuestions({
  visible,
  initial,
  mealOnly = false,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: Profile;
  mealOnly?: boolean;
  onClose: () => void;
  onSubmit: (profile: Profile, save: boolean) => void;
}) {
  const theme = useTheme();
  const [diets, setDiets] = useState<Diet[]>(initial.diets);
  const [allergies, setAllergies] = useState<Allergy[]>(initial.allergies);
  const [otherDiets, setOtherDiets] = useState<string[]>(initial.otherDiets);
  const [otherAllergies, setOtherAllergies] = useState<string[]>(initial.otherAllergies);
  const [dietOther, setDietOther] = useState(initial.otherDiets.length > 0);
  const [allergyOther, setAllergyOther] = useState(initial.otherAllergies.length > 0);
  const [servings, setServings] = useState(initial.household_size);
  const [save, setSave] = useState(!mealOnly);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View>
        <ThemedText type="section">{mealOnly ? 'Change for this meal' : 'A few quick questions'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {mealOnly ? 'Cooking for guests? Your saved profile stays as it is.' : 'So I only show dishes that fit your household.'}
        </ThemedText>
      </View>

      <View style={styles.group}>
        <ThemedText type="label">Dietary needs</ThemedText>
        <MultiPills
          options={(Object.keys(DIET_INFO) as Diet[]).map((d) => ({ value: d, label: DIET_INFO[d].label }))}
          value={diets}
          onChange={setDiets}
          other={dietOther}
          onOtherToggle={(on) => {
            setDietOther(on);
            if (!on) setOtherDiets([]);
          }}
        />
        {dietOther && <OtherInput value={otherDiets} onChange={setOtherDiets} placeholder="e.g. no beef, walang baboy" />}
      </View>

      <View style={styles.group}>
        <ThemedText type="label">Allergies</ThemedText>
        <MultiPills
          options={(Object.keys(ALLERGY_INFO) as Allergy[]).map((a) => ({ value: a, label: ALLERGY_INFO[a].label }))}
          value={allergies}
          onChange={setAllergies}
          other={allergyOther}
          onOtherToggle={(on) => {
            setAllergyOther(on);
            if (!on) setOtherAllergies([]);
          }}
        />
        {allergyOther && <OtherInput value={otherAllergies} onChange={setOtherAllergies} placeholder="e.g. squid, sili" />}
      </View>

      <View style={styles.servings}>
        <ThemedText type="label">Servings</ThemedText>
        <Stepper value={servings} onChange={setServings} min={1} max={20} />
      </View>

      <Pressable onPress={() => setSave((s) => !s)} style={styles.check} accessibilityRole="checkbox" accessibilityState={{ checked: save }}>
        <View style={[styles.box, { borderColor: theme.tint, backgroundColor: save ? theme.tint : 'transparent' }]}>
          {save && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
        <ThemedText type="caption" style={{ flex: 1 }}>
          Save to my household profile so you don&apos;t ask again
        </ThemedText>
      </Pressable>

      <Button
        title="Show dishes"
        onPress={() => onSubmit({ ...initial, diets, otherDiets, allergies, otherAllergies, household_size: servings }, save)}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: Spacing.two },
  servings: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
