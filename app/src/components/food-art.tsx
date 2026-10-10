import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { RECIPE_IMAGES } from '@/data/recipe-images';
import { useTheme } from '@/hooks/use-theme';

/** Whether a recipe has its own dish photo. */
export const hasRecipeImage = (recipeId?: string) => !!recipeId && recipeId in RECIPE_IMAGES;

/** The recipe's dish photo, or a peach tile with a dish icon when it has none. */
export function FoodArt({
  size,
  style,
  radius = 12,
  recipeId,
}: {
  size: number;
  style?: ViewStyle;
  radius?: number;
  recipeId?: string;
}) {
  const theme = useTheme();
  const photo = recipeId ? RECIPE_IMAGES[recipeId] : undefined;
  return (
    <View style={[styles.art, { backgroundColor: theme.highlight, borderRadius: radius }, style ?? { width: size, height: size }]}>
      {photo ? (
        <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <Ionicons name="restaurant-outline" size={size * 0.42} color={theme.tint} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
