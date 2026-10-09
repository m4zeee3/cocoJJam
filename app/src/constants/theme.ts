/**
 * Design tokens from the FigJam "Palette & type" frame.
 * Light and airy: orange is the accent, never a big block behind text;
 * green only means fresh or on-device.
 */

const Palette = {
  peach: '#FFF3EA', // summary card, soft highlights
  orange: '#EA580C', // buttons, scan, active nav
  orangeText: '#C2410C', // links, prices, button labels
  ink: '#23211E', // headings and body text
  white: '#FFFFFF', // cards, bottom nav
  cream: '#FAF8F5', // app background
  freshGreen: '#16A34A', // fresh stage, on-device chip
  amber: '#F59E0B', // use soon stage
  red: '#E5484D', // use today stage
  gray: '#6B6862', // secondary text
  border: '#EFEAE4',
} as const;

const light = {
  text: Palette.ink,
  textSecondary: Palette.gray,
  background: Palette.cream,
  backgroundElement: Palette.white,
  backgroundSelected: Palette.border,
  tint: Palette.orange,
  tintText: Palette.orangeText,
  highlight: Palette.peach,
  // Home summary card: a deeper peach than `highlight` so it stands out on cream, plus its bubbles.
  summary: '#FFE9DB',
  summaryBubble: '#FFDCC4',
  fresh: Palette.freshGreen,
  freshSoft: '#E8F7EE',
  amber: Palette.amber,
  amberSoft: '#FEF5E1',
  danger: Palette.red,
  dangerSoft: '#FDECEC',
} as const;

// The design is light-only (app.json sets userInterfaceStyle to light).
export const Colors = { light, dark: light } as const;

export type ThemeColor = keyof typeof light;

/** Plus Jakarta Sans, one family per weight (loaded in src/app/_layout.tsx). */
export const Fonts = {
  medium: 'PlusJakartaSans_500Medium',
  semiBold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extraBold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { card: 16, pill: 999, button: 999 } as const;
