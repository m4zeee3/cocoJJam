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
  note: { flexDirection: 'row', gap: Spacing.two, borderRadius: 12, padding: Spacing.two + 2 },
  noteIcon: { marginTop: 1 },
});
