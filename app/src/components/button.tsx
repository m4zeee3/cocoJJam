import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  size = 'large',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'soft';
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'large' | 'small';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const colors = {
    primary: { bg: theme.tint, fg: '#fff', border: theme.tint },
    secondary: { bg: theme.backgroundElement, fg: theme.text, border: theme.backgroundSelected },
    soft: { bg: theme.highlight, fg: theme.tintText, border: theme.highlight },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        size === 'small' && styles.small,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}>
      {icon && <Ionicons name={icon} size={size === 'small' ? 14 : 18} color={colors.fg} />}
      <ThemedText type={size === 'small' ? 'label' : 'smallBold'} style={{ color: colors.fg }}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.button,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, alignSelf: 'flex-start' },
});
