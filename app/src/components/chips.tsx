import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Quick-reply chips under a chatbot question. */
export function Chips<T extends string>({
  options,
  onPick,
}: {
  options: { value: T; label: string }[];
  onPick: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onPick(o.value)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: pressed ? theme.highlight : theme.backgroundElement,
              borderColor: theme.backgroundSelected,
            },
          ]}>
          <ThemedText type="label">{o.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
  },
});
