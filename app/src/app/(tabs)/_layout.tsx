import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isScanChatOpen, openScanner } from '@/lib/open-scanner';

function ion(name: keyof typeof Ionicons.glyphMap) {
  return function TabBarIcon({ color }: { color: ColorValue }) {
    return <Ionicons name={name} color={color} size={22} />;
  };
}

function PantryIcon({ color }: { color: ColorValue }) {
  return <MaterialCommunityIcons name="fridge-outline" color={color} size={22} />;
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle: { fontFamily: Fonts.semiBold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.backgroundSelected,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          position: 'absolute',
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ion('home-outline') }} />
      <Tabs.Screen name="pantry" options={{ title: 'Pantry', tabBarIcon: PantryIcon }} />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          // First time: ask camera or gallery, then show the chat. Once the chat has been
          // opened, the tab goes back to it as it was (the default tab press keeps its photos).
          tabBarButton: ({ accessibilityState, onPress }) => (
            <Pressable
              onPress={(e) => (isScanChatOpen() ? onPress?.(e) : openScanner())}
              accessibilityRole="button"
              accessibilityLabel="Scan"
              accessibilityState={accessibilityState}
              style={styles.scanSlot}>
              <View style={[styles.scanButton, { backgroundColor: theme.tint }]}>
                <Ionicons name="scan" size={28} color="#fff" />
              </View>
              <ThemedText type="caption" style={[styles.scanLabel, { color: theme.text }]}>
                Scan
              </ThemedText>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="palengke" options={{ title: 'Palengke', tabBarIcon: ion('basket-outline') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: ion('book-outline') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scanSlot: { flex: 1, alignItems: 'center' },
  scanButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    elevation: 6,
    shadowColor: '#EA580C',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  scanLabel: { fontFamily: Fonts.bold, marginTop: 2 },
});
