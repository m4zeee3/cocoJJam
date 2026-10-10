import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ChoicePills } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { signsFor, spoiledSigns, stageFromSigns, type Answers } from '@/domain/freshness-signs';
import type { Item } from '@/ml/read';

/**
 * The user's own check (UC-1.11): one row per sign for this item (color, smell, feel; eyes and
 * gills for fish), each answered fresh or spoiled. Any spoiled sign makes it spoiled.
 * `onDone` gets the stage and a short line for the chat ("No warning signs" or the signs found).
 */
export function FreshnessCheck({ item, onDone }: { item: Item | null; onDone: (stage: 'fresh' | 'spoiled', summary: string) => void }) {
  const signs = signsFor(item);
  const [answers, setAnswers] = useState<Answers>({});
  const stage = stageFromSigns(signs, answers);

  function done() {
    if (!stage) return;
    const bad = spoiledSigns(signs, answers);
    onDone(stage, bad.length ? bad.join(' · ') : 'No warning signs');
  }

  return (
    <View style={styles.wrap}>
      {signs.map((s) => (
        <View key={s.id} style={styles.sign}>
          <ThemedText type="label">{s.label}</ThemedText>
          <ChoicePills
            options={[
              { value: 'fresh' as const, label: s.fresh },
              { value: 'spoiled' as const, label: s.spoiled },
            ]}
            value={answers[s.id] ?? null}
            onChange={(v) => setAnswers((a) => ({ ...a, [s.id]: v }))}
          />
        </View>
      ))}
      <ThemedText type="caption" themeColor="textSecondary">
        Any one warning sign means don&apos;t eat it.
      </ThemedText>
      <Button title="Done" size="small" disabled={!stage} onPress={done} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  sign: { gap: Spacing.one },
});
