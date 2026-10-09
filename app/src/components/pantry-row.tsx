import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Pill } from '@/components/badges';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import type { PantryItem } from '@/db/pantry';
import { daysUntil, shortCountdown } from '@/domain/cook-by';
import { STORAGE_LABEL, UNIT_LABEL } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

function countdownTone(days: number): { fg: ThemeColor; bg: ThemeColor } {
  if (days < 0) return { fg: 'textSecondary', bg: 'backgroundSelected' };
  if (days <= 1) return { fg: 'danger', bg: 'dangerSoft' };
  if (days <= 3) return { fg: 'amber', bg: 'amberSoft' };
  return { fg: 'fresh', bg: 'freshSoft' };
}

/** One P01 row: thumbnail, name, amount · storage, countdown pill. Opens the item detail. */
export function PantryRow({ item, divider }: { item: PantryItem; divider?: boolean }) {
  const theme = useTheme();
  const days = daysUntil(item.cook_by);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
        pressed && { opacity: 0.7 },
      ]}>
      <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
        {item.thumbnail_uri ? (
          <Image source={{ uri: item.thumbnail_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Ionicons name="nutrition-outline" size={20} color={theme.tint} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold" style={styles.name}>
          {item.name}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {days < 0 ? 'Past estimate' : `${item.quantity} ${UNIT_LABEL[item.unit] ?? item.unit}`} · {STORAGE_LABEL[item.storage]}
        </ThemedText>
      </View>
      <Pill label={shortCountdown(days)} tone={countdownTone(days)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  thumb: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  name: { textTransform: 'capitalize' },
});
