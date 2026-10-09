import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Note } from '@/components/chat';
import { Sheet } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { signInWithGoogle } from '@/sync/account';
import { OfflineError } from '@/sync/api';
import { SignInCancelled } from '@/sync/google';
import { activePantryCount, adoptGuestData, removeGuestData, syncNow } from '@/sync/sync';
import { useTheme } from '@/hooks/use-theme';

type Counts = { pantry: number; scans: number; bookmarks: number };
type Step = { kind: 'offline' } | { kind: 'keep'; counts: Counts } | { kind: 'done'; local: number; account: number } | null;

/**
 * Google sign-in with the follow-up sheets: 09 keep guest data (UC-11.3),
 * 10 signed in and merged, 11 offline (UC-11.2 alt). `onDone` runs after
 * the last sheet closes.
 */
export function useGoogleSignIn(onDone: () => void) {
  const db = useSQLiteContext();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>(null);

  async function start() {
    setBusy(true);
    try {
      const { guest } = await signInWithGoogle(db);
      if (guest.pantry + guest.scans + guest.bookmarks > 0) {
        setStep({ kind: 'keep', counts: guest });
      } else {
        await finish(0);
      }
    } catch (e) {
      if (e instanceof SignInCancelled) return;
      if (e instanceof OfflineError) setStep({ kind: 'offline' });
      else Alert.alert('Sign-in failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Sync, then report how many pantry items came from this phone vs the account. */
  async function finish(local: number) {
    try {
      await syncNow(db);
    } catch {
      // Offline after signing in: changes stay queued and sync later (UC-11.5).
    }
    const total = await activePantryCount(db);
    setStep({ kind: 'done', local, account: Math.max(0, total - local) });
  }

  async function keep(counts: Counts) {
    setBusy(true);
    await adoptGuestData(db);
    await finish(counts.pantry);
    setBusy(false);
  }

  async function fresh() {
    setBusy(true);
    await removeGuestData(db);
    await finish(0);
    setBusy(false);
  }

  const element = (
    <>
      <Sheet visible={step?.kind === 'offline'} onClose={() => setStep(null)}>
        <SheetIcon icon="cloud-offline-outline" tone="neutral" />
        <ThemedText type="section" style={styles.center}>
          Sign-in needs a connection
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          You&apos;re offline right now. Scanning, your pantry and recipes still work as a guest.
        </ThemedText>
        <Button
          title="Keep using as guest"
          onPress={() => {
            setStep(null);
            onDone();
          }}
        />
        <TextButton
          title="Try again"
          onPress={() => {
            setStep(null);
            start();
          }}
        />
      </Sheet>

      <Sheet visible={step?.kind === 'keep'} onClose={() => {}}>
        {step?.kind === 'keep' && (
          <>
            <SheetIcon icon="cloud-upload-outline" tone="orange" />
            <ThemedText type="section" style={styles.center}>
              Keep your items in your account?
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              You saved these on this phone as a guest. We&apos;ll back them up so they&apos;re safe if you change phones.
            </ThemedText>
            <View style={styles.counts}>
              <Count n={step.counts.pantry} label="pantry items" />
              <Count n={step.counts.scans} label="scans" />
              <Count n={step.counts.bookmarks} label="bookmarks" />
            </View>
            <Button title="Keep in my account" disabled={busy} onPress={() => keep(step.counts)} />
            <Button title="Start fresh" variant="secondary" disabled={busy} onPress={fresh} />
            <ThemedText type="caption" themeColor="textSecondary" style={styles.center}>
              Start fresh removes the guest data from this phone.
            </ThemedText>
          </>
        )}
      </Sheet>

      <Sheet
        visible={step?.kind === 'done'}
        onClose={() => {
          setStep(null);
          onDone();
        }}>
        {step?.kind === 'done' && (
          <>
            <SheetIcon icon="checkmark" tone="fresh" />
            <ThemedText type="section" style={styles.center}>
              You&apos;re signed in
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              {step.local > 0 && step.account > 0
                ? `Combined ${step.local} items from this phone with ${step.account} from your account.`
                : step.account > 0
                  ? `Restored ${step.account} items from your account.`
                  : step.local > 0
                    ? `Backed up ${step.local} items from this phone.`
                    : 'Your pantry and bookmarks now back up to your account.'}
            </ThemedText>
            {step.local > 0 && step.account > 0 && (
              <Note icon="information-circle-outline" tone="neutral">
                Duplicates were kept. You can remove extras in your Pantry.
              </Note>
            )}
            <Button
              title="Go to pantry"
              onPress={() => {
                setStep(null);
                onDone();
                router.navigate('/pantry');
              }}
            />
            <TextButton
              title="Back to home"
              onPress={() => {
                setStep(null);
                onDone();
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );

  return { start, busy, element };
}

function SheetIcon({ icon, tone }: { icon: keyof typeof Ionicons.glyphMap; tone: 'orange' | 'fresh' | 'neutral' }) {
  const theme = useTheme();
  const c = { orange: [theme.highlight, theme.tint], fresh: [theme.freshSoft, theme.fresh], neutral: [theme.backgroundSelected, theme.textSecondary] }[tone];
  return (
    <View style={[styles.icon, { backgroundColor: c[0] }]}>
      <Ionicons name={icon} size={22} color={c[1]} />
    </View>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <Card tone="background" style={styles.count}>
      <ThemedText type="section">{n}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Card>
  );
}

function TextButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.textButton}>
      <ThemedText type="label" themeColor="tintText">
        {title}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  icon: { alignSelf: 'center', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  counts: { flexDirection: 'row', gap: Spacing.two },
  count: { flex: 1, alignItems: 'center', gap: 0, paddingVertical: Spacing.two + 2 },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
