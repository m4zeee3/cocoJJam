import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Stage } from '@/domain/types';

/** One item in a finished scan. Fields after `stage` are optional: older scans only have name and stage. */
export type ScanSummary = {
  name: string;
  stage: Stage;
  photo?: string | null;
  daysLeft?: number;
  /** 'pantry' = added, 'wasted' = logged as wasted, undefined = neither. */
  outcome?: 'pantry' | 'wasted';
};

export type ScanRecord = {
  id: string;
  title: string;
  created_at: number;
  items: ScanSummary[];
};

type Row = { id: string; title: string; created_at: number; messages_json: string };
const toRecord = (r: Row): ScanRecord => ({ ...r, items: (JSON.parse(r.messages_json).items ?? []) as ScanSummary[] });

/** UC-7.1: keep each finished scan so it shows in Recent scans and the Library. */
export async function addScan(db: SQLiteDatabase, items: ScanSummary[], createdAt = Date.now()) {
  const title = items.map((i) => i.name).join(', ');
  await db.runAsync(
    `INSERT INTO scan_history (id, updated_at, title, created_at, messages_json) VALUES (?, ?, ?, ?, ?)`,
    randomUUID(), Date.now(), title, createdAt, JSON.stringify({ items }),
  );
}

export async function listRecentScans(db: SQLiteDatabase, limit = 2): Promise<ScanRecord[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT id, title, created_at, messages_json FROM scan_history WHERE deleted = 0 ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
  return rows.map(toRecord);
}

export async function getScan(db: SQLiteDatabase, id: string): Promise<ScanRecord | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT id, title, created_at, messages_json FROM scan_history WHERE id = ? AND deleted = 0`,
    id,
  );
  return row ? toRecord(row) : null;
}

/** UC-7.3: remove the chat only; pantry items added from it stay. */
export async function deleteScan(db: SQLiteDatabase, id: string) {
  await db.runAsync(`UPDATE scan_history SET deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?`, Date.now(), id);
}
