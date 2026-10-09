import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Bottom space so content clears the floating tab bar and its raised Scan button. */
export const TAB_BAR_CLEARANCE = 120;

export function Screen({ children, scroll = true, ...rest }: ScrollViewProps & { scroll?: boolean }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} {...rest}>
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing.three + 4, paddingBottom: TAB_BAR_CLEARANCE, gap: Spacing.four },
});
