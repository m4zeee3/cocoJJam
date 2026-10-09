import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteAccount } from '@/sync/account';
import { OfflineError } from '@/sync/api';

/** 14 Delete account (UC-11.7): removes the server copy; data on this phone stays. */
export default function DeleteAccountScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toUpperCase() === 'DELETE';

  async function confirm() {
    setBusy(true);
    try {
      await deleteAccount(db);
      router.back();
    } catch (e) {
      Alert.alert(
        'Could not delete your account',
        e instanceof OfflineError ? 'You need a connection to delete the online backup. Try again when you’re online.' : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.icon, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="trash-outline" size={22} color={theme.danger} />
        </View>
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="title">Delete your account?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This permanently deletes your account and its online backup. Data on this phone stays unless you clear it.
          </ThemedText>
        </View>
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="label">What gets deleted</ThemedText>
          {['Synced pantry and scan history', 'Bookmarks and your count on recipes', 'Household profile backup'].map((t) => (
            <View key={t} style={styles.inline}>
              <Ionicons name="close" size={14} color={theme.danger} />
              <ThemedText type="small">{t}</ThemedText>
            </View>
          ))}
        </Card>
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="label">Type DELETE to confirm</ThemedText>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            placeholder="DELETE"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: ready ? theme.danger : theme.backgroundSelected, color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          onPress={confirm}
          disabled={!ready || busy}
          accessibilityRole="button"
          style={[styles.danger, { backgroundColor: theme.danger, opacity: !ready || busy ? 0.5 : 1 }]}>
          <ThemedText type="smallBold" style={{ color: '#fff' }}>
            {busy ? 'Deleting…' : 'Delete account'}
          </ThemedText>
        </Pressable>
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.four },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.semiBold, fontSize: 14 },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two, gap: Spacing.two },
  danger: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
});
