import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { syncNow } from '@/sync/sync';

const EVERY_MS = 60_000;

/**
 * UC-11.5: signed-in users sync on launch, when the app returns to the
 * foreground, and every minute while open. Offline attempts fail quietly;
 * changes stay queued (dirty = 1) until the next one succeeds.
 */
export function AutoSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    const run = () => syncNow(db).catch(() => {});
    run();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    const timer = setInterval(() => AppState.currentState === 'active' && run(), EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [db]);
  return null;
}
