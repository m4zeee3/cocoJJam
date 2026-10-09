import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { ChoicePills, Stepper } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { ALLERGY_INFO, DIET_INFO, type Allergy, type Diet } from '@/db/profile';
import { peso } from '@/domain/prices';
import { ingredientsFor, understands } from '@/domain/custom-terms';
import { getRecipe, INGREDIENT_KEYS, viewRecipe } from '@/domain/recipes';
import { useTheme } from '@/hooks/use-theme';

type IconName = keyof typeof Ionicons.glyphMap;

const DIET_ICON: Record<Diet, IconName> = {
  no_pork: 'ban-outline',
  halal: 'moon-outline',
  low_salt: 'water-outline',
};
const ALLERGY_ICON: Record<Allergy, IconName> = {
  shellfish: 'bug-outline',
  fish: 'fish-outline',
  peanuts: 'ellipse-outline',
  egg: 'egg-outline',
};

/** A tappable row with icon, label, hint and a checkbox (H01, H02). */
export function CheckRow({
  icon,
  label,
  hint,
  checked,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[
        styles.row,
        { borderColor: checked ? theme.tint : theme.backgroundSelected, backgroundColor: checked ? theme.highlight : theme.backgroundElement },
      ]}>
      <View style={[styles.rowIcon, { backgroundColor: checked ? theme.backgroundElement : theme.background }]}>
        <Ionicons name={icon} size={16} color={checked ? theme.tint : theme.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {hint && (
          <ThemedText type="caption" themeColor="textSecondary">
            {hint}
          </ThemedText>
        )}
      </View>
      <View style={[styles.box, { borderColor: checked ? theme.tint : theme.backgroundSelected, backgroundColor: checked ? theme.tint : 'transparent' }]}>
        {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

export function StepTitle({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="title">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
    </View>
  );
}

/**
 * Free-text entries, comma-separated, saved on the phone. Shows what each one
 * will hide, or that the app can't filter by it (it's still saved and shown).
 */
export function OtherInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value.join(', '));
  const terms = text.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const hidden = [...new Set(terms.flatMap((t) => [...ingredientsFor(t, INGREDIENT_KEYS)]))];
  const unknown = terms.filter((t) => !understands(t, INGREDIENT_KEYS));
  return (
    <View style={{ gap: Spacing.one + 2 }}>
      <TextInput
        autoFocus={value.length === 0}
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(t.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: theme.tint, color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      {hidden.length > 0 && (
        <ThemedText type="caption" themeColor="fresh">
          I&apos;ll hide dishes with {hidden.slice(0, 6).join(', ')}
          {hidden.length > 6 ? ' and more' : ''}.
        </ThemedText>
      )}
      {unknown.length > 0 && (
        <ThemedText type="caption" themeColor="textSecondary">
          Saved, but I can&apos;t filter dishes by “{unknown.join('”, “')}” yet.
        </ThemedText>
      )}
      <ThemedText type="caption" themeColor="textSecondary">
        Separate with commas. Saved on this phone, works offline.
      </ThemedText>
    </View>
  );
}

/** H01: dietary needs, pick all that apply, plus typed-in ones. */
export function DietStep({
  value,
  other,
  onChange,
  onOtherChange,
}: {
  value: Diet[];
  other: string[];
  onChange: (v: Diet[]) => void;
  onOtherChange: (v: string[]) => void;
}) {
  const [typing, setTyping] = useState(other.length > 0);
  const toggle = (d: Diet) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  const none = value.length === 0 && other.length === 0 && !typing;
  return (
    <View style={styles.list}>
      <CheckRow
        icon="happy-outline"
        label="No restrictions"
        checked={none}
        onPress={() => {
          onChange([]);
          onOtherChange([]);
          setTyping(false);
        }}
      />
      {(Object.keys(DIET_INFO) as Diet[]).map((d) => (
        <CheckRow key={d} icon={DIET_ICON[d]} label={DIET_INFO[d].label} hint={DIET_INFO[d].hint} checked={value.includes(d)} onPress={() => toggle(d)} />
      ))}
      <CheckRow
        icon="ellipsis-horizontal"
        label="Other"
        hint="Type it in, e.g. no beef, walang baboy"
        checked={typing}
        onPress={() => {
          if (typing) onOtherChange([]);
          setTyping(!typing);
        }}
      />
      {typing && <OtherInput value={other} onChange={onOtherChange} placeholder="e.g. no beef, no red meat" />}
    </View>
  );
}

/** H02: allergies, including typed-in ones. */
export function AllergyStep({
  value,
  other,
  onChange,
  onOtherChange,
}: {
  value: Allergy[];
  other: string[];
  onChange: (v: Allergy[]) => void;
  onOtherChange: (v: string[]) => void;
}) {
  const [typing, setTyping] = useState(other.length > 0);
  const toggle = (a: Allergy) => onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  const none = value.length === 0 && other.length === 0 && !typing;
  return (
    <View style={styles.list}>
      <CheckRow
        icon="happy-outline"
        label="No allergies"
        checked={none}
        onPress={() => {
          onChange([]);
          onOtherChange([]);
          setTyping(false);
        }}
      />
      {(Object.keys(ALLERGY_INFO) as Allergy[]).map((a) => (
        <CheckRow key={a} icon={ALLERGY_ICON[a]} label={ALLERGY_INFO[a].label} hint={ALLERGY_INFO[a].hint} checked={value.includes(a)} onPress={() => toggle(a)} />
      ))}
      <CheckRow
        icon="ellipsis-horizontal"
        label="Other"
        hint="Type it in"
        checked={typing}
        onPress={() => {
          if (typing) onOtherChange([]);
          setTyping(!typing);
        }}
      />
      {typing && <OtherInput value={other} onChange={onOtherChange} placeholder="e.g. squid, sili, kamatis" />}
      <Note icon="alert-circle-outline" tone="amber">
        Always double-check labels for severe allergies.
      </Note>
    </View>
  );
}

/** H03: household size, with an example cost. */
export function SizeStep({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  const sinigang = getRecipe('sinigang-na-bangus');
  const example = sinigang ? viewRecipe(sinigang, [], value).cost : null;
  return (
    <View style={styles.list}>
      <Card style={styles.sizeCard}>
        <View style={styles.people}>
          {Array.from({ length: Math.min(value, 6) }, (_, i) => (
            <View key={i} style={[styles.person, { backgroundColor: i % 2 ? theme.freshSoft : theme.highlight }]}>
              <Ionicons name="person-outline" size={16} color={i % 2 ? theme.fresh : theme.tint} />
            </View>
          ))}
          {value > 6 && <ThemedText type="label">+{value - 6}</ThemedText>}
        </View>
        <Stepper value={value} onChange={onChange} min={1} max={20} />
        <ThemedText type="caption" themeColor="textSecondary">
          {value === 1 ? 'person' : 'people'}
        </ThemedText>
      </Card>
      {example != null && (
        <Note icon="information-circle-outline" tone="neutral">
          {`Example: Sinigang na Bangus for ${value} is about ${peso(example)}.`}
        </Note>
      )}
    </View>
  );
}

const BUDGETS = [1000, 1500, 2000, 3000];

/** H04: weekly grocery budget, optional. */
export function BudgetStep({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.list}>
      <View style={[styles.budget, { borderColor: theme.tint, backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="title" themeColor="textSecondary">
          ₱
        </ThemedText>
        <TextInput
          value={value ? value.toLocaleString('en-US') : ''}
          onChangeText={(t) => {
            const n = Number(t.replace(/[^\d]/g, ''));
            onChange(n > 0 ? n : null);
          }}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={theme.textSecondary}
          style={[styles.budgetText, { color: theme.text }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          / week
        </ThemedText>
      </View>
      <ChoicePills
        options={BUDGETS.map((b) => ({ value: String(b), label: peso(b) }))}
        value={value ? String(value) : null}
        onChange={(b) => onChange(Number(b))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, borderWidth: 1, borderRadius: 14, padding: Spacing.three - 4 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.medium, fontSize: 14 },
  sizeCard: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  people: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  person: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  budget: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  budgetText: { flex: 1, fontFamily: Fonts.extraBold, fontSize: 26, paddingVertical: Spacing.one },
});
