import type { SQLiteDatabase } from 'expo-sqlite';

import { getFlag, setFlag } from '@/db/profile';

/**
 * The scanner chat thread, kept on the phone (app_state) so it stays like a
 * messenger conversation across scans and app restarts. Local only: never synced.
 */
const KEY = 'scan_thread';

/** Older messages are dropped past this, so the thread stays light. */
const MAX_MESSAGES = 200;

export type Thread<M> = {
  messages: M[];
  /** The last photos param turned into a turn, so a remount doesn't scan it twice. */
  lastPhotos: string | null;
};

export async function loadThread<M>(db: SQLiteDatabase): Promise<Thread<M>> {
  try {
    const raw = await getFlag(db, KEY);
    if (raw) {
      const t = JSON.parse(raw) as Thread<M>;
      if (Array.isArray(t.messages)) return { messages: t.messages, lastPhotos: t.lastPhotos ?? null };
    }
  } catch {
    // A bad saved thread just starts fresh.
  }
  return { messages: [], lastPhotos: null };
}

export async function saveThread<M>(db: SQLiteDatabase, thread: Thread<M>) {
  const messages = thread.messages.slice(-MAX_MESSAGES);
  await setFlag(db, KEY, JSON.stringify({ messages, lastPhotos: thread.lastPhotos }));
}
