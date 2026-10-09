import type { SQLiteDatabase } from 'expo-sqlite';

import { setFlag } from '@/db/profile';
import { api } from '@/sync/api';
import { googleIdToken, googleSignOut } from '@/sync/google';
import { clearSession, getSession, saveSession, type Session, type SessionUser } from '@/sync/session';
import { clearLocalData, detachLocalData, guestCounts } from '@/sync/sync';

/**
 * UC-11.2: Google account picker → backend creates or loads the user → session
 * saved on the phone. Returns what the guest had saved, for the "Keep your
 * items?" question (UC-11.3).
 */
export async function signInWithGoogle(db: SQLiteDatabase) {
  const { idToken, photo } = await googleIdToken();
  const res = await api<{ token: string; user: SessionUser }>('/auth/google', { method: 'POST', body: { id_token: idToken } });
  const session: Session = { token: res.token, user: { ...res.user, photo } };
  const guest = await guestCounts(db);
  // Don't sync until the user answers "Keep your items in your account?".
  await setFlag(db, 'sync_paused', guest.pantry + guest.scans + guest.bookmarks > 0 ? '1' : '0');
  await saveSession(db, session);
  return { session, guest };
}

/** UC-11.6: keep the data on this phone as guest data, or remove it. */
export async function signOut(db: SQLiteDatabase, keepData: boolean) {
  await googleSignOut();
  if (keepData) await detachLocalData(db);
  else await clearLocalData(db);
  await clearSession(db);
  await setFlag(db, 'sync_paused', '0');
}

/** UC-11.7: delete the server copy; data on this phone stays as guest data. */
export async function deleteAccount(db: SQLiteDatabase) {
  const session = await getSession(db);
  if (!session) return;
  await api('/account', { method: 'DELETE', token: session.token });
  await signOut(db, true);
}
