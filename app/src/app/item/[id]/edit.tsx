import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ChoicePills, Segmented, Sheet, Stepper } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { deletePantryItem, getPantryItem, recompute, updatePantryItem, type PantryItem } from '@/db/pantry';
import { PURCHASE_LABEL, UNIT_LABEL, type Purchase, type Storage } from '@/domain/types';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';

const STORAGES: { value: Storage; label: string }[] = [
  { value: 'ref', label: 'Ref' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'counter', label: 'Counter' },
];
const PURCHASES = (Object.keys(PURCHASE_LABEL) as Purchase[]).map((value) => ({ value, label: PURCHASE_LABEL[value] }));

/** P10 edit item (UC-2.8). Loads the item, then hands it to the form. */
export default function EditItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [item] = useFocusQuery<PantryItem | null | undefined>((d) => getPantryItem(d, id), undefined);
  if (!item) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;
  return <EditForm item={item} />;
}

function EditForm({ item }: { item: PantryItem }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unit, setUnit] = useState(item.unit);
  const [storage, setStorage] = useState(item.storage);
  const [purchase, setPurchase] = useState(item.purchase);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const units = ['pc', 'kg', 'g', ...(['pc', 'kg', 'g'].includes(item.unit) ? [] : [item.unit])].map((value) => ({
    value,
    label: UNIT_LABEL[value] ?? value,
  }));
  const step = unit === 'g' ? 50 : unit === 'kg' ? 0.25 : 1;

  async function save() {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return;
    await updatePantryItem(db, item.id, {
      name: trimmed,
      quantity,
      unit,
      // Changing storage or the purchase date recalculates the countdown.
      ...recompute({ ...item, name: trimmed }, { storage, purchase }),
    });
    router.back();
  }

  async function remove() {
    await deletePantryItem(db, item.id);
    setConfirmDelete(false);
    router.dismissTo('/pantry');
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.roundIcon, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <ThemedText type="section" style={{ flex: 1 }}>
          Edit item
        </ThemedText>
        <Pressable onPress={save} disabled={!name.trim()} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="tintText">
            Save
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            style={[styles.input, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
          />
        </Field>

        <Field label="Quantity">
          <View style={styles.row}>
            <Stepper value={quantity} onChange={setQuantity} min={step} step={step} max={unit === 'g' ? 10000 : 999} />
            <ChoicePills
              options={units}
              value={unit}
              onChange={(u) => {
                setUnit(u);
                if (u === 'g' && quantity < 50) setQuantity(250);
              }}
            />
          </View>
        </Field>

        <Field label="Storage">
          <Segmented options={STORAGES} value={storage} onChange={setStorage} />
        </Field>

        <Field label="When did you buy it?">
          <ChoicePills options={PURCHASES} value={purchase} onChange={setPurchase} />
        </Field>

        <View style={styles.row}>
          <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Changing storage or date recalculates the countdown.
          </ThemedText>
        </View>

        <Pressable onPress={() => setConfirmDelete(true)} style={styles.deleteLink}>
          <Ionicons name="trash-outline" size={16} color={theme.danger} />
          <ThemedText type="smallBold" themeColor="danger">
            Delete item
          </ThemedText>
        </Pressable>
      </ScrollView>

      {/* P11: delete without counting it as waste. */}
      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <View style={[styles.deleteIcon, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="trash-outline" size={22} color={theme.danger} />
        </View>
        <ThemedText type="section" style={styles.centerText}>
          Delete {item.name}?
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          This removes it from your pantry. It won&apos;t count as wasted food, so use this for items added by mistake.
        </ThemedText>
        <Pressable onPress={remove} style={[styles.dangerButton, { backgroundColor: theme.danger }]} accessibilityRole="button">
          <ThemedText type="smallBold" style={{ color: '#fff' }}>
            Delete item
          </ThemedText>
        </Pressable>
        <Button title="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} />
      </Sheet>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="label">{label}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  roundIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.four, paddingBottom: 80 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.medium, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three - 4 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, marginTop: Spacing.five },
  deleteIcon: { alignSelf: 'center', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  dangerButton: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
});
