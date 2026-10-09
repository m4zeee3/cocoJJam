import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** Peach tile with a dish icon, standing in for the FigJam food illustrations. */
export function FoodArt({ size, style, radius = 12 }: { size: number; style?: ViewStyle; radius?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.art, { backgroundColor: theme.highlight, borderRadius: radius }, style ?? { width: size, height: size }]}>
      <Ionicons name="restaurant-outline" size={size * 0.42} color={theme.tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
