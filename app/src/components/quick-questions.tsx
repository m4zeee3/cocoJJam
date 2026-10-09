import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ChoicePills, Sheet, Stepper } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { ALLERGY_LABEL, DIET_LABEL, type Allergy, type Diet, type Profile } from '@/db/profile';
import { useTheme } from '@/hooks/use-theme';

const DIETS = (Object.keys(DIET_LABEL) as Diet[]).map((value) => ({ value, label: DIET_LABEL[value] }));
const ALLERGIES = Object.keys(ALLERGY_LABEL) as Allergy[];

/** R02 (UC-3.1, 5.1): diet, allergies and servings before showing dishes. */
export function QuickQuestions({
  visible,
  initial,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: Profile;
  onClose: () => void;
  onSubmit: (profile: Profile, save: boolean) => void;
}) {
  const theme = useTheme();
  const [diet, setDiet] = useState(initial.diet);
  const [allergies, setAllergies] = useState<Allergy[]>(initial.allergies);
  const [servings, setServings] = useState(initial.household_size);
  const [save, setSave] = useState(true);

  function toggle(a: Allergy | 'none') {
    if (a === 'none') return setAllergies([]);
    setAllergies((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View>
        <ThemedText type="section">A few quick questions</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          So I only show dishes that fit your household.
        </ThemedText>
      </View>

      <View style={styles.group}>
        <ThemedText type="label">Dietary needs</ThemedText>
        <ChoicePills options={DIETS} value={diet} onChange={setDiet} />
      </View>

      <View style={styles.group}>
        <ThemedText type="label">Allergies</ThemedText>
        <View style={styles.pills}>
          {(['none', ...ALLERGIES] as (Allergy | 'none')[]).map((a) => {
            const selected = a === 'none' ? allergies.length === 0 : allergies.includes(a);
            return (
              <Pressable
                key={a}
                onPress={() => toggle(a)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                style={[
                  styles.pill,
                  {
                    borderColor: selected ? theme.tint : theme.backgroundSelected,
                    backgroundColor: selected ? theme.highlight : theme.backgroundElement,
                  },
                ]}>
                {selected && a !== 'none' && <Ionicons name="checkmark" size={12} color={theme.tintText} />}
                <ThemedText type="label" themeColor={selected ? 'tintText' : 'text'}>
                  {a === 'none' ? 'None' : ALLERGY_LABEL[a]}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
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

      <Button title="Show dishes" onPress={() => onSubmit({ ...initial, diet, allergies, household_size: servings }, save)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
  },
  servings: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
