import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { STAGE_LABEL, type Stage, type Urgency } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

type Tone = { fg: ThemeColor; bg: ThemeColor };

const STAGE_TONE: Record<Stage, Tone> = {
  fresh: { fg: 'fresh', bg: 'freshSoft' },
  good: { fg: 'fresh', bg: 'freshSoft' },
  use_soon: { fg: 'amber', bg: 'amberSoft' },
  spoiled: { fg: 'danger', bg: 'dangerSoft' },
};

export const STAGE_COLOR: Record<Stage, ThemeColor> = {
  fresh: 'fresh',
  good: 'fresh',
  use_soon: 'amber',
  spoiled: 'danger',
};

export const URGENCY_COLOR: Record<Urgency, ThemeColor> = {
  'Check now': 'danger',
  'Use today': 'danger',
  'Use soon': 'amber',
  Fresh: 'fresh',
};

export function Dot({ color, size = 8 }: { color: ThemeColor; size?: number }) {
  const theme = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme[color] }} />;
}

/** A soft pill with a colored dot, e.g. "● Good". */
export function Pill({ label, tone }: { label: string; tone: Tone }) {
  const theme = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: theme[tone.bg] }]}>
      <Dot color={tone.fg} size={6} />
      <ThemedText type="label" themeColor={tone.fg}>
        {label}
      </ThemedText>
    </View>
  );
}

export function StagePill({ stage }: { stage: Stage }) {
  return <Pill label={STAGE_LABEL[stage]} tone={STAGE_TONE[stage]} />;
}

/** "● On-device AI · Works offline" */
export function OnDeviceBadge({ label = 'On-device AI · Works offline' }: { label?: string }) {
  return <Pill label={label} tone={{ fg: 'fresh', bg: 'freshSoft' }} />;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one + 2,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: Spacing.one,
  },
});
