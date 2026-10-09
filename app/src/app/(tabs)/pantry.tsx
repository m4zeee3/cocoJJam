import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Dot, URGENCY_COLOR } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ChoicePills } from '@/components/controls';
import { PantryRow } from '@/components/pantry-row';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { urgencyGroup } from '@/domain/cook-by';
import { pantryValue, peso } from '@/domain/prices';
import { STORAGE_LABEL, type Storage, type Urgency } from '@/domain/types';
import { openListCount } from '@/db/shopping';
import { useFocusQuery, usePantry } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';

const GROUPS: Urgency[] = ['Use today', 'Use soon', 'Fresh', 'Check now'];

/** Module 2: Smart Pantry, grouped by urgency (P01, P02 · UC-2.2). */
export default function PantryScreen() {
  const items = usePantry();
  const theme = useTheme();
  const [listCount] = useFocusQuery(openListCount, 0);
  const [filter, setFilter] = useState<'all' | Storage>('all');
  const total = items.reduce((sum, i) => sum + pantryValue(i), 0);
  const shown = filter === 'all' ? items : items.filter((i) => i.storage === filter);
  const count = (s: Storage) => items.filter((i) => i.storage === s).length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three }}>
      <View style={{ gap: 2, flex: 1 }}>
        <ThemedText type="title">Pantry</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {items.length} item{items.length === 1 ? '' : 's'}
          {total > 0 ? ` · ${peso(total)} worth of food` : ''}
        </ThemedText>
      </View>
        {/* N04 Shopping list (UC-9.1) */}
        <Pressable
          onPress={() => router.push('/shopping')}
          accessibilityLabel={`Shopping list, ${listCount} items`}
          hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="list" size={18} color={theme.text} />
          {listCount > 0 && (
            <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: theme.tint, alignItems: 'center', justifyContent: 'center' }}>
              <ThemedText type="caption" style={{ color: '#fff', fontSize: 10, lineHeight: 12 }}>
                {listCount}
              </ThemedText>
            </View>
          )}
        </Pressable>
      </View>

      {items.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="section">Your pantry is empty</ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Scan raw food and it shows up here with a countdown, so you know what to cook first.
          </ThemedText>
          <View style={{ alignSelf: 'stretch' }}>
            <Button title="Scan an item" icon="scan" onPress={() => openScanner()} />
          </View>
        </Card>
      ) : (
        <ChoicePills
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${items.length}` },
            ...(['ref', 'freezer', 'counter'] as Storage[]).map((s) => ({ value: s, label: `${STORAGE_LABEL[s]} ${count(s)}` })),
          ]}
        />
      )}

      {GROUPS.map((title) => {
        const rows = shown.filter((i) => urgencyGroup(i.cook_by) === title);
        if (rows.length === 0) return null;
        return (
          <View key={title} style={{ gap: Spacing.two }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <Dot color={URGENCY_COLOR[title]} />
              <ThemedText type="smallBold">{title}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary" style={{ flex: 1 }}>
                {rows.length}
              </ThemedText>
              {title === 'Use today' && (
                <Pressable onPress={() => router.push('/recipes')} style={{ flexDirection: 'row', alignItems: 'center' }} hitSlop={8}>
                  <ThemedText type="label" themeColor="tintText">
                    Cook with these
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={14} color={theme.tintText} />
                </Pressable>
              )}
            </View>
            <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
              {rows.map((item, i) => (
                <PantryRow key={item.id} item={item} divider={i > 0} />
              ))}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
