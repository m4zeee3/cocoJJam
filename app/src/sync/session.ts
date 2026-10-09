import type { SQLiteDatabase } from 'expo-sqlite';

import { getFlag, setFlag } from '@/db/profile';

export type SessionUser = { id: string; email: string; name: string; photo?: string | null };
export type Session = { token: string; user: SessionUser };

/** The signed-in session lives in app_state on the phone; null = guest. */
export async function getSession(db: SQLiteDatabase): Promise<Session | null> {
  const raw = await getFlag(db, 'session');
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function saveSession(db: SQLiteDatabase, s: Session) {
  return setFlag(db, 'session', JSON.stringify(s));
}

export async function clearSession(db: SQLiteDatabase) {
  await db.runAsync(`DELETE FROM app_state WHERE key IN ('session', 'sync_cursor', 'last_synced')`);
}

export async function getLastSynced(db: SQLiteDatabase): Promise<number | null> {
  const raw = await getFlag(db, 'last_synced');
  return raw ? Number(raw) : null;
}
