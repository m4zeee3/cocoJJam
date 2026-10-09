import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

/** Module 7: Library with Scans and Recipes tabs. TODO: UC-7.1–7.3. */
export default function LibraryScreen() {
  return (
    <Screen>
      <ThemedText type="title">Library</ThemedText>
      <Card>
        <ThemedText themeColor="textSecondary">Coming soon: past scans and saved recipes.</ThemedText>
      </Card>
    </Screen>
  );
}
