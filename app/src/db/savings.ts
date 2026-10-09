import type { SQLiteDatabase } from 'expo-sqlite';

import type { PantryItem } from '@/db/pantry';

/** Month bounds in ms; `offset` 0 = this month, -1 = last month. */
export function monthRange(offset = 0, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start: start.getTime(), end: end.getTime(), date: start };
}

/**
 * Items marked Used or Wasted in a month (UC-8.1). `updated_at` is when the
 * status changed: a finished item isn't edited afterwards.
 */
export function listFinished(db: SQLiteDatabase, start: number, end: number) {
  return db.getAllAsync<PantryItem & { updated_at: number }>(
    `SELECT * FROM pantry_items
     WHERE status IN ('used', 'wasted') AND deleted = 0 AND updated_at >= ? AND updated_at < ?
     ORDER BY updated_at DESC`,
    start, end,
  );
}
