import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StagePill } from '@/components/badges';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { BotTurn, Note } from '@/components/chat';
import { Sheet } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { deleteScan, getScan, type ScanRecord } from '@/db/history';
import { longCountdown } from '@/domain/cook-by';
import { useFocusQuery } from '@/hooks/use-pantry';
import { useTheme } from '@/hooks/use-theme';
import { openScanner } from '@/lib/open-scanner';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return today ? `Today, ${time}` : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/** L02 past scan reopened (UC-7.1), L03 delete a scan chat (UC-7.3). */
export default function PastScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const load = useCallback((d: SQLiteDatabase) => getScan(d, id), [id]);
  const [scan] = useFocusQuery<ScanRecord | null | undefined>(load, undefined);
  const [confirming, setConfirming] = useState(false);

  if (scan === undefined) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} />;
  if (scan === null) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">This scan was deleted.</ThemedText>
        <Button title="Back" size="small" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const title = scan.items.map((i) => capitalize(i.name)).join(', ');
  const added = scan.items.filter((i) => i.outcome === 'pantry').length;
  const photos = scan.items.map((i) => i.photo).filter((p): p is string => !!p);

  function openMenu() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Delete chat', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (i) => i === 0 && setConfirming(true),
      );
    } else {
      Alert.alert(title, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete chat', style: 'destructive', onPress: () => setConfirming(true) },
      ]);
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.backgroundSelected }]}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <ThemedText type="section" style={{ fontSize: 16 }} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {when(scan.created_at)}
          </ThemedText>
        </View>
        <RoundButton icon="ellipsis-horizontal" label="More" onPress={openMenu} />
      </View>

      <ScrollView contentContainerStyle={styles.chat}>
        <View style={[styles.stamp, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            {when(scan.created_at)}
          </ThemedText>
        </View>

        {photos.length > 0 && (
          <View style={[styles.photos, { borderColor: theme.highlight }]}>
            {photos.map((p) => (
              <Image key={p} source={{ uri: p }} style={styles.photo} contentFit="cover" />
            ))}
          </View>
        )}

        <BotTurn>
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {scan.items.map((i, n) => (
              <View key={n} style={[styles.itemRow, n > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected }]}>
                <View style={[styles.thumb, { backgroundColor: theme.highlight }]}>
                  {i.photo && <Image source={{ uri: i.photo }} style={StyleSheet.absoluteFill} contentFit="cover" />}
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{capitalize(i.name)}</ThemedText>
                  <ThemedText type="caption" themeColor={i.stage === 'spoiled' ? 'danger' : 'tintText'}>
                    {i.stage === 'spoiled' ? "Don't cook or eat" : i.daysLeft != null && i.daysLeft < 0 ? 'Past the safe window' : i.daysLeft != null ? `Cook within ${longCountdown(i.daysLeft).toLowerCase()}` : 'Scanned'}
                  </ThemedText>
                </View>
                <StagePill stage={i.stage} />
              </View>
            ))}
          </Card>
          {added > 0 && (
            <Note icon="checkmark" tone="fresh">
              {added === scan.items.length && added > 1 ? 'All added to your pantry' : added === 1 && scan.items.length === 1 ? 'Added to your pantry' : `${added} added to your pantry`}
            </Note>
          )}
          {scan.items.some((i) => i.outcome === 'wasted') && (
            <Note icon="trash-outline" tone="danger">
              Logged as wasted
            </Note>
          )}
        </BotTurn>
      </ScrollView>

      <View style={styles.footer}>
        <Note icon="time-outline" tone="neutral">
          Past scan · the cook-by window was as of this scan. Rescan to check again.
        </Note>
        <Button title="Scan again" icon="scan" onPress={() => openScanner()} />
      </View>

      {/* L03 */}
      <Sheet visible={confirming} onClose={() => setConfirming(false)}>
        <View style={[styles.deleteIcon, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="trash-outline" size={22} color={theme.danger} />
        </View>
        <ThemedText type="section" style={styles.centerText}>
          Delete this scan chat?
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.centerText}>
          {title} · {when(scan.created_at)}
        </ThemedText>
        {added > 0 && (
          <Note icon="information-circle-outline" tone="fresh">
            {`The ${added === 1 ? 'item' : `${added} items`} you added stay${added === 1 ? 's' : ''} in your pantry.`}
          </Note>
        )}
        <Pressable
          onPress={async () => {
            await deleteScan(db, scan.id);
            setConfirming(false);
            router.back();
          }}
          accessibilityRole="button"
          style={[styles.dangerButton, { backgroundColor: theme.danger }]}>
          <ThemedText type="smallBold" style={{ color: '#fff' }}>
            Delete chat
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => setConfirming(false)} style={styles.textButton}>
          <ThemedText type="label" themeColor="tintText">
            Cancel
          </ThemedText>
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={[styles.round, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingHorizontal: Spacing.three + 4, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chat: { padding: Spacing.three, gap: Spacing.three },
  stamp: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  photos: { alignSelf: 'flex-end', flexDirection: 'row', gap: 4, borderWidth: 4, borderRadius: 16, overflow: 'hidden' },
  photo: { width: 90, height: 90 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.two + 2 },
  thumb: { width: 36, height: 36, borderRadius: 10, overflow: 'hidden' },
  footer: { paddingHorizontal: Spacing.three + 4, paddingBottom: Spacing.two, gap: Spacing.two },
  deleteIcon: { alignSelf: 'center', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  dangerButton: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  textButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
