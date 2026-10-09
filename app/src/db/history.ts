import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Stage } from '@/domain/types';

export type ScanSummary = { name: string; stage: Stage };

export type ScanRecord = {
  id: string;
  title: string;
  created_at: number;
  items: ScanSummary[];
};

/** UC-7.1: keep each finished scan so it shows in Recent scans and the Library. */
export async function addScan(db: SQLiteDatabase, items: ScanSummary[], createdAt = Date.now()) {
  const title = items.map((i) => i.name).join(', ');
  await db.runAsync(
    `INSERT INTO scan_history (id, updated_at, title, created_at, messages_json) VALUES (?, ?, ?, ?, ?)`,
    randomUUID(), Date.now(), title, createdAt, JSON.stringify({ items }),
  );
}

export async function listRecentScans(db: SQLiteDatabase, limit = 2): Promise<ScanRecord[]> {
  const rows = await db.getAllAsync<{ id: string; title: string; created_at: number; messages_json: string }>(
    `SELECT id, title, created_at, messages_json FROM scan_history WHERE deleted = 0 ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ ...r, items: (JSON.parse(r.messages_json).items ?? []) as ScanSummary[] }));
}
