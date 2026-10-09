import { useFocusEffect } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { listActivePantry, type PantryItem } from '@/db/pantry';

/** Runs `query` each time the screen comes into focus; `reload` runs it again on demand. */
export function useFocusQuery<T>(query: (db: SQLiteDatabase) => Promise<T>, initial: T) {
  const db = useSQLiteContext();
  const [data, setData] = useState<T>(initial);
  const [version, setVersion] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      query(db).then((rows) => active && setData(rows));
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` is a module-level function
    }, [db, version]),
  );

  return [data, () => setVersion((v) => v + 1)] as const;
}

/** Active pantry items, reloaded whenever the screen comes into focus. */
export function usePantry() {
  return useFocusQuery<PantryItem[]>(listActivePantry, [])[0];
}
