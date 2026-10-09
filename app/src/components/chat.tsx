import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function BotAvatar() {
  const theme = useTheme();
  return (
    <View style={[styles.avatar, { backgroundColor: theme.tint }]}>
      <Ionicons name="scan" size={14} color="#fff" />
    </View>
  );
}

/** A bot turn: avatar on the left, then one or more bubbles or cards. */
export function BotTurn({ children }: { children: ReactNode }) {
  return (
    <View style={styles.botRow}>
      <BotAvatar />
      <View style={styles.botBody}>{children}</View>
    </View>
  );
}

export function BotBubble({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.bubble, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      {typeof children === 'string' ? <ThemedText type="small">{children}</ThemedText> : children}
    </View>
  );
}

export function UserBubble({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.userBubble, { backgroundColor: theme.tint }]}>
      <ThemedText type="label" style={{ color: '#fff' }}>
        {text}
      </ThemedText>
    </View>
  );
}

export function PhotoBubble({ uri }: { uri: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.photo, { borderColor: theme.highlight }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </View>
  );
}

/** Several photos sent at once (multi-photo scan), as one bubble. */
export function PhotoGrid({ uris }: { uris: string[] }) {
  const theme = useTheme();
  return (
    <View style={[styles.grid, { backgroundColor: theme.highlight }]}>
      {uris.map((uri, i) => (
        <View key={i} style={styles.gridCell}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        </View>
      ))}
    </View>
  );
}

/** Time line between scans in the thread: "Today 5:09 PM". */
export function TimeDivider({ at }: { at: number }) {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day =
    d.toDateString() === today.toDateString()
      ? 'Today'
      : d.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <ThemedText type="caption" themeColor="textSecondary" style={styles.divider}>
      {day} {time}
    </ThemedText>
  );
}

/** A bubble of photo tips, one icon per line (S10, S14b, S15). */
export function TipList({ title, tips }: { title?: string; tips: { icon: keyof typeof Ionicons.glyphMap; text: string }[] }) {
  const theme = useTheme();
  return (
    <BotBubble>
      {title ? <ThemedText type="label">{title}</ThemedText> : null}
      {tips.map((t) => (
        <View key={t.text} style={styles.tip}>
          <View style={[styles.tipIcon, { backgroundColor: theme.highlight }]}>
            <Ionicons name={t.icon} size={12} color={theme.tint} />
          </View>
          <ThemedText type="caption" style={{ flex: 1 }}>
            {t.text}
          </ThemedText>
        </View>
      ))}
    </BotBubble>
  );
}

/** A tinted note inside a card, e.g. the meat and fish smell check. */
export function Note({
  icon,
  tone,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'amber' | 'danger' | 'fresh' | 'neutral';
  children: ReactNode;
}) {
  const theme = useTheme();
  const colors = {
    amber: { bg: theme.amberSoft, fg: theme.tintText },
    danger: { bg: theme.dangerSoft, fg: theme.danger },
    fresh: { bg: theme.freshSoft, fg: theme.fresh },
    neutral: { bg: theme.highlight, fg: theme.tintText },
  }[tone];
  return (
    <View style={[styles.note, { backgroundColor: colors.bg }]}>
      <Ionicons name={icon} size={14} color={colors.fg} style={styles.noteIcon} />
      <View style={{ flex: 1 }}>
        {typeof children === 'string' ? (
          <ThemedText type="caption" style={{ color: colors.fg }}>
            {children}
          </ThemedText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  botRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  botBody: { flex: 1, gap: Spacing.two },
  bubble: {
    borderWidth: 1,
    borderRadius: Radius.card,
    borderTopLeftRadius: 4,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two + 2,
    gap: Spacing.two,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderRadius: Radius.card,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
  },
  photo: {
    alignSelf: 'flex-end',
    width: 150,
    height: 150,
    borderRadius: Radius.card,
    borderWidth: 4,
    overflow: 'hidden',
  },
  tip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grid: { alignSelf: 'flex-end', width: '62%', flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 16 },
  gridCell: { width: '48.5%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  divider: { textAlign: 'center', marginTop: Spacing.two },
  tipIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: Spacing.two, borderRadius: 12, padding: Spacing.two + 2 },
  noteIcon: { marginTop: 1 },
});
