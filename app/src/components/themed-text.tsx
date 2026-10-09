import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'title' | 'section' | 'default' | 'small' | 'smallBold' | 'caption' | 'label';
  themeColor?: ThemeColor;
};

// Type scale from the FigJam "Palette & type" frame.
export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  // ExtraBold 26–28 · headlines
  title: { fontFamily: Fonts.extraBold, fontSize: 26, lineHeight: 32 },
  // Bold 18 · section titles
  section: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24 },
  // Medium 13–14 · body
  default: { fontFamily: Fonts.medium, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18 },
  // SemiBold / Bold 11–12 · chips, labels, buttons
  smallBold: { fontFamily: Fonts.semiBold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: Fonts.medium, fontSize: 11, lineHeight: 15 },
  label: { fontFamily: Fonts.bold, fontSize: 12, lineHeight: 16 },
});
