import type { SQLiteDatabase } from 'expo-sqlite';

import { getFlag, setFlag } from '@/db/profile';
import { api } from '@/sync/api';
import { getSession, type Session } from '@/sync/session';

/** Tables mirrored to the backend; same names as its collections (backend/README.md). */
const TABLES = ['pantry_items', 'scan_history', 'bookmarks', 'profiles'] as const;
type Table = (typeof TABLES)[number];
const META = new Set(['id', 'owner_id', 'updated_at', 'deleted', 'dirty']);

type Row = Record<string, unknown> & { id: string; updated_at: number; deleted: number };
type SyncRecord = { id: string; updated_at: number; deleted: boolean; data: Record<string, unknown> };

const columnCache = new Map<Table, string[]>();
async function columns(db: SQLiteDatabase, table: Table) {
  if (!columnCache.has(table)) {
    const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    columnCache.set(table, info.map((c) => c.name));
  }
  return columnCache.get(table)!;
}

/** Upload rows changed since the last push (UC-11.3, 11.5). */
async function push(db: SQLiteDatabase, session: Session) {
  const changes: Partial<Record<Table, SyncRecord[]>> = {};
  const sent: { table: Table; id: string; updated_at: number }[] = [];
  for (const table of TABLES) {
    const rows = await db.getAllAsync<Row>(`SELECT * FROM ${table} WHERE dirty = 1`);
    if (rows.length === 0) continue;
    changes[table] = rows.map((r) => ({
      id: r.id,
      updated_at: r.updated_at,
      deleted: !!r.deleted,
      data: Object.fromEntries(Object.entries(r).filter(([k]) => !META.has(k))),
    }));
    sent.push(...rows.map((r) => ({ table, id: r.id, updated_at: r.updated_at })));
  }
  if (sent.length === 0) return 0;
  await api('/sync/push', { method: 'POST', token: session.token, body: { changes } });
  // Clear the flag only if the row wasn't edited again while we were pushing.
  for (const s of sent) {
    await db.runAsync(
      `UPDATE ${s.table} SET dirty = 0, owner_id = ? WHERE id = ? AND updated_at = ?`,
      session.user.id, s.id, s.updated_at,
    );
  }
  return sent.length;
}

/** Download changes since the last pull; the newer `updated_at` wins (UC-11.4, 11.5). */
async function pull(db: SQLiteDatabase, session: Session) {
  const since = Number((await getFlag(db, 'sync_cursor')) ?? 0);
  const res = await api<{ cursor: number; changes: Partial<Record<Table, SyncRecord[]>> }>(`/sync/pull?since=${since}`, {
    token: session.token,
  });
  let applied = 0;
  for (const table of TABLES) {
    const records = res.changes[table] ?? [];
    if (records.length === 0) continue;
    const cols = await columns(db, table);
    for (const rec of records) {
      const local = await db.getFirstAsync<{ updated_at: number }>(`SELECT updated_at FROM ${table} WHERE id = ?`, rec.id);
      if (local && local.updated_at >= rec.updated_at) continue;
      const dataCols = cols.filter((c) => !META.has(c) && c in rec.data);
      const names = ['id', 'owner_id', 'updated_at', 'deleted', 'dirty', ...dataCols];
      const values = [rec.id, session.user.id, rec.updated_at, rec.deleted ? 1 : 0, 0, ...dataCols.map((c) => rec.data[c] as string | number | null)];
      await db.runAsync(
        `INSERT OR REPLACE INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...values,
      );
      applied++;
    }
  }
  await setFlag(db, 'sync_cursor', String(res.cursor));
  return applied;
}

let running: Promise<{ pushed: number; pulled: number }> | null = null;

/** Push then pull. No-op for guests. Throws OfflineError when the server can't be reached. */
export function syncNow(db: SQLiteDatabase) {
  running ??= (async () => {
    try {
      const session = await getSession(db);
      // Paused while a new sign-in decides what to do with guest data (UC-11.3).
      if (!session || (await getFlag(db, 'sync_paused')) === '1') return { pushed: 0, pulled: 0 };
      const pushed = await push(db, session);
      const pulled = await pull(db, session);
      await setFlag(db, 'last_synced', String(Date.now()));
      return { pushed, pulled };
    } finally {
      running = null;
    }
  })();
  return running;
}

// --- guest data (UC-11.3, 11.6) ----------------------------------------------

/** What a guest saved on this phone: shown on "Keep your items in your account?". */
export async function guestCounts(db: SQLiteDatabase) {
  const count = async (sql: string) => (await db.getFirstAsync<{ n: number }>(sql))?.n ?? 0;
  return {
    pantry: await count(`SELECT COUNT(*) AS n FROM pantry_items WHERE owner_id IS NULL AND deleted = 0 AND status = 'active'`),
    scans: await count(`SELECT COUNT(*) AS n FROM scan_history WHERE owner_id IS NULL AND deleted = 0`),
    bookmarks: await count(`SELECT COUNT(*) AS n FROM bookmarks WHERE owner_id IS NULL AND deleted = 0`),
  };
}

/** "Keep in my account": mark guest rows for upload. */
export async function adoptGuestData(db: SQLiteDatabase) {
  for (const t of TABLES) await db.runAsync(`UPDATE ${t} SET dirty = 1 WHERE owner_id IS NULL`);
  await setFlag(db, 'sync_paused', '0');
}

/** "Start fresh": drop guest rows (never uploaded, so nothing else to clean up). */
export async function removeGuestData(db: SQLiteDatabase) {
  for (const t of TABLES) await db.runAsync(`DELETE FROM ${t} WHERE owner_id IS NULL`);
  await db.runAsync(`DELETE FROM palengke_checks`);
  await setFlag(db, 'sync_paused', '0');
}

/** Sign out, keep data: the rows become guest data on this phone again. */
export async function detachLocalData(db: SQLiteDatabase) {
  for (const t of TABLES) await db.runAsync(`UPDATE ${t} SET owner_id = NULL, dirty = 0`);
}

/** Sign out, remove data: clear everything stored on this phone. */
export async function clearLocalData(db: SQLiteDatabase) {
  for (const t of TABLES) await db.runAsync(`DELETE FROM ${t}`);
  await db.runAsync(`DELETE FROM palengke_checks`);
}

/** Active pantry items, for "Combined N items from this phone with M from your account". */
export async function activePantryCount(db: SQLiteDatabase) {
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM pantry_items WHERE deleted = 0 AND status = 'active'`))?.n ?? 0;
}
