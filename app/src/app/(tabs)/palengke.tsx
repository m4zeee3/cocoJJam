import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

/** Module 6: Palengke Mode. TODO: reuse classify() + price table for a buy verdict (UC-6.1–6.6). */
export default function PalengkeScreen() {
  return (
    <Screen>
      <ThemedText type="title">Palengke Mode</ThemedText>
      <Card>
        <ThemedText themeColor="textSecondary">Coming soon: snap an item, enter the price, get a buy verdict.</ThemedText>
      </Card>
    </Screen>
  );
}
