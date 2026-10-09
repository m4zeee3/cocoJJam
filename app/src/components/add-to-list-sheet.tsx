import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BudgetBar } from '@/components/budget-bar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Sheet } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { addToList } from '@/db/shopping';
import type { Budget } from '@/domain/budget';
import { peso } from '@/domain/prices';
import type { RecipeView } from '@/domain/recipes';
import { useTheme } from '@/hooks/use-theme';

/** N03 add missing items to your list (UC-9.1). Everything the pantry doesn't cover starts checked. */
export function AddToListSheet({
  view,
  budget,
  onClose,
  onAdded,
}: {
  view: RecipeView;
  budget: Budget | null;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const missing = view.lines.filter((l) => l.have !== 'all');
  const [picked, setPicked] = useState<Set<string>>(new Set(missing.map((l) => l.item)));
  const chosen = missing.filter((l) => picked.has(l.item));
  const total = chosen.reduce((s, l) => s + l.toBuy, 0);
  const inPantry = view.lines.length - missing.length;

  function toggle(item: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  return (
    <Sheet visible onClose={onClose}>
      <View>
        <ThemedText type="section">Add missing items to your list</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {view.title} · you already have {inPantry} of {view.lines.length}
        </ThemedText>
      </View>
      <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
        {missing.map((l, i) => {
          const on = picked.has(l.item);
          return (
            <Pressable
              key={l.item}
              onPress={() => toggle(l.item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
              <View style={[styles.box, { borderColor: theme.tint, backgroundColor: on ? theme.tint : 'transparent' }]}>
                {on && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{l.name}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {l.have === 'some' ? `${l.amount} · ${l.haveText?.toLowerCase()}` : l.amount}
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{l.cost == null ? '—' : peso(l.toBuy)}</ThemedText>
            </Pressable>
          );
        })}
      </Card>
      {budget && (
        <Card tone="background" style={{ borderColor: theme.backgroundSelected }}>
          <BudgetBar budget={budget} adding={total} />
        </Card>
      )}
      <Button
        title={`Add ${chosen.length} item${chosen.length === 1 ? '' : 's'} · ${peso(total)}`}
        icon="list"
        disabled={chosen.length === 0}
        onPress={async () => {
          const n = await addToList(db, view, chosen);
          onAdded(n);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
