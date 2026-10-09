import { StyleSheet, View, type ViewProps } from 'react-native';

import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** White rounded card with a hairline border; pass `tone` for a tinted one. */
export function Card({ style, tone, ...rest }: ViewProps & { tone?: ThemeColor }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        tone
          ? { backgroundColor: theme[tone], borderColor: theme[tone] }
          : { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
});
