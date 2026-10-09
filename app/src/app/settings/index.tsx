import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Sheet } from '@/components/controls';
import { useGoogleSignIn } from '@/components/sign-in-flow';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { signOut } from '@/sync/account';
import { apiConfigured, OfflineError } from '@/sync/api';
import { GOOGLE_AVAILABLE } from '@/sync/google';
import { getLastSynced, getSession, type Session } from '@/sync/session';
import { syncNow } from '@/sync/sync';

async function load(db: SQLiteDatabase) {
  const [session, lastSynced] = await Promise.all([getSession(db), getLastSynced(db)]);
  return { session, lastSynced };
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 12 Account settings (UC-11.5), 13 sign out (UC-11.6). Reached from the profile icon on Home. */
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [data, reload] = useFocusQuery(load, { session: null as Session | null, lastSynced: null as number | null });
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'offline'>('idle');
  const [signingOut, setSigningOut] = useState(false);
  const signIn = useGoogleSignIn(reload);
  const { session, lastSynced } = data;

  async function sync() {
    setSyncState('syncing');
    try {
      await syncNow(db);
      setSyncState('idle');
    } catch (e) {
      setSyncState(e instanceof OfflineError ? 'offline' : 'idle');
    }
    reload();
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
        <ThemedText type="section">Account</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {session ? (
          <>
            <Card style={styles.profile}>
              {session.user.photo ? (
                <Image source={{ uri: session.user.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: theme.highlight }]}>
                  <ThemedText type="section" themeColor="tintText">
                    {(session.user.name || session.user.email)[0]?.toUpperCase()}
                  </ThemedText>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{session.user.name || 'Signed in'}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {session.user.email}
                </ThemedText>
                <View style={styles.inline}>
                  <Ionicons name="logo-google" size={11} color={theme.textSecondary} />
                  <ThemedText type="caption" themeColor="textSecondary">
                    Signed in with Google
                  </ThemedText>
                </View>
              </View>
            </Card>
            <Card style={styles.syncRow}>
              <View style={[styles.rowIcon, { backgroundColor: syncState === 'offline' ? theme.amberSoft : theme.freshSoft }]}>
                <Ionicons name={syncState === 'offline' ? 'cloud-offline-outline' : 'sync'} size={16} color={syncState === 'offline' ? theme.amber : theme.fresh} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">
                  {syncState === 'syncing' ? 'Syncing…' : syncState === 'offline' ? 'Offline · changes queued' : lastSynced ? 'Backed up' : 'Not synced yet'}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {syncState === 'offline'
                    ? 'Everything still works here. It syncs when you’re back online.'
                    : lastSynced
                      ? `Last synced: ${fmt(lastSynced)}`
                      : 'Tap Sync now to back up'}
                </ThemedText>
              </View>
              <Pressable onPress={sync} disabled={syncState === 'syncing'} hitSlop={8}>
                <ThemedText type="label" themeColor="tintText">
                  Sync now
                </ThemedText>
              </Pressable>
            </Card>
          </>
        ) : (
          <Card style={{ gap: Spacing.three - 4 }}>
            <View style={styles.profile}>
              <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Guest</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  Everything is saved on this phone only.
                </ThemedText>
              </View>
            </View>
            {GOOGLE_AVAILABLE ? (
              <Button title="Sign in with Google" icon="logo-google" variant="secondary" disabled={signIn.busy || !apiConfigured()} onPress={signIn.start} />
            ) : (
              <ThemedText type="caption" themeColor="textSecondary">
                Google sign-in works in the full app build, not in Expo Go.
              </ThemedText>
            )}
            {GOOGLE_AVAILABLE && !apiConfigured() && (
              <ThemedText type="caption" themeColor="danger">
                Sync server not set. Add EXPO_PUBLIC_API_URL to app/.env and restart.
              </ThemedText>
            )}
          </Card>
        )}

        <Section title="Preferences">
          <Row icon="people-outline" label="Household profile" onPress={() => router.push('/household')} />
        </Section>

        {session && (
          <Section title="Account">
            <Row icon="log-out-outline" label="Sign out" onPress={() => setSigningOut(true)} />
            <Row icon="trash-outline" label="Delete account" tone="danger" onPress={() => router.push('/settings/delete-account')} divider />
          </Section>
        )}

        <ThemedText type="caption" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Version {Constants.expoConfig?.version ?? '1.0'} · AI runs on this phone
        </ThemedText>
      </ScrollView>

      {signingOut && <SignOutSheet onClose={() => setSigningOut(false)} onDone={reload} />}
      {signIn.element}
    </SafeAreaView>
  );
}

/** 13: choose what happens to the data on this phone. */
function SignOutSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [keep, setKeep] = useState(true);
  const options = [
    { value: true, title: 'Keep data on this phone', body: 'Keep using the app as a guest with your pantry.' },
    { value: false, title: 'Remove data from this phone', body: 'Your account backup stays safe online.' },
  ];
  return (
    <Sheet visible onClose={onClose}>
      <View style={[styles.sheetIcon, { backgroundColor: theme.highlight }]}>
        <Ionicons name="log-out-outline" size={22} color={theme.tint} />
      </View>
      <ThemedText type="section" style={{ textAlign: 'center' }}>
        Sign out?
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Choose what happens to the data on this phone.
      </ThemedText>
      {options.map((o) => {
        const selected = keep === o.value;
        return (
          <Pressable
            key={o.title}
            onPress={() => setKeep(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.option, { borderColor: selected ? theme.tint : theme.backgroundSelected, backgroundColor: selected ? theme.highlight : theme.backgroundElement }]}>
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? theme.tint : theme.textSecondary} />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{o.title}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {o.body}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
      <Button
        title="Sign out"
        onPress={async () => {
          await signOut(db, keep);
          onClose();
          onDone();
        }}
      />
      <Pressable onPress={onClose} style={styles.textButton}>
        <ThemedText type="label" themeColor="tintText">
          Cancel
        </ThemedText>
      </Pressable>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="caption" themeColor="textSecondary">
        {title.toUpperCase()}
      </ThemedText>
      <Card style={{ gap: 0, paddingVertical: Spacing.one }}>{children}</Card>
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
  tone = 'text',
  divider,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: ThemeColor;
  divider?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={16} color={theme[tone]} />
      <ThemedText type="small" themeColor={tone} style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three + 4, gap: Spacing.four },
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.three - 4 },
  sheetIcon: { alignSelf: 'center', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, borderWidth: 1, borderRadius: 14, padding: Spacing.three - 4 },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
