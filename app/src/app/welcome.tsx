import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { useGoogleSignIn } from '@/components/sign-in-flow';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { setFlag } from '@/db/profile';
import { useTheme } from '@/hooks/use-theme';
import { GOOGLE_AVAILABLE } from '@/sync/google';

/** 02 Welcome (UC-11.1, 11.2): guest-first, Google sign-in optional. Shown on first launch. */
export default function WelcomeScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  async function enter() {
    await setFlag(db, 'welcome_seen', '1');
    router.replace('/');
  }

  const signIn = useGoogleSignIn(enter);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Illustration exported from the FigJam 02 Welcome frame (assets/images/welcome-hero.png, 3x) */}
      <Image
        source={require('@/assets/images/welcome-hero.png')}
        style={styles.hero}
        contentFit="contain"
        accessibilityLabel="A bowl of soup with a fish, a tomato and herbs, labelled Cook today and Fresh, 3 days"
      />

      <View style={styles.body}>
        <ThemedText type="title">Know what&apos;s fresh. Cook before it spoils.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Scan raw beef, pork, chicken or fish, track your pantry and get budget-friendly dishes. All on your phone.
        </ThemedText>
      </View>

      <View style={styles.footer}>
        <Button title="Continue as guest" onPress={enter} />
        {GOOGLE_AVAILABLE ? (
          <Button title="Continue with Google" icon="logo-google" variant="secondary" disabled={signIn.busy} onPress={signIn.start} />
        ) : (
          <ThemedText type="caption" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Google sign-in works in the full app build, not in Expo Go.
          </ThemedText>
        )}
        <ThemedText type="caption" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Signing in is optional. It backs up your pantry and adds your bookmarks to community counts.
        </ThemedText>
      </View>
      {signIn.element}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  hero: { marginHorizontal: Spacing.three + 4, marginTop: Spacing.three, width: undefined, aspectRatio: 342 / 330 },
  body: { paddingHorizontal: Spacing.three + 4, gap: Spacing.two },
  footer: { marginTop: 'auto', paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two, gap: Spacing.two + 2 },
});
