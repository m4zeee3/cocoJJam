import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { proteinOf } from '@/domain/prices';
import { useTheme } from '@/hooks/use-theme';

/** Placeholder art for an item with no photo: fish, drumstick or steak. */
export function ItemIcon({ name, size }: { name: string; size: number }) {
  const theme = useTheme();
  const kind = proteinOf(name);
  if (kind === 'fish' || kind === null) return <Ionicons name="fish-outline" size={size} color={theme.tint} />;
  return (
    <MaterialCommunityIcons name={kind === 'chicken' ? 'food-drumstick-outline' : 'food-steak'} size={size} color={theme.tint} />
  );
}
