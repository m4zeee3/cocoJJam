import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { estimateCookBy, parseIsoDate, toIsoDate } from '@/domain/cook-by';
import type { Confidence, Purchase, Stage, Storage } from '@/domain/types';

export type PantryItem = {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string;
  storage: Storage;
  stage: Stage;
  confidence: Confidence;
  purchase: Purchase;
  date_added: string;
  added_at: number;
  cook_by: string;
  rescan_tomorrow: number;
  scan_count: number;
  thumbnail_uri: string | null;
  paid_price_php: number | null;
  status: 'active' | 'used' | 'wasted';
};

export type NewPantryItem = Omit<
  PantryItem,
  'id' | 'status' | 'rescan_tomorrow' | 'scan_count' | 'added_at' | 'purchase'
> & {
  purchase?: Purchase;
  rescan_tomorrow?: boolean;
};

/** UC-2.1: save a scanned item. */
export async function addPantryItem(db: SQLiteDatabase, item: NewPantryItem): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO pantry_items
      (id, updated_at, added_at, name, category, quantity, unit, storage, stage, confidence, purchase,
       date_added, cook_by, rescan_tomorrow, thumbnail_uri, paid_price_php)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, now, now, item.name, item.category, item.quantity, item.unit, item.storage,
    item.stage, item.confidence, item.purchase ?? 'today', item.date_added, item.cook_by,
    item.rescan_tomorrow ? 1 : 0, item.thumbnail_uri, item.paid_price_php,
  );
  return id;
}

/** UC-2.2: active items, most urgent first. */
export function listActivePantry(db: SQLiteDatabase): Promise<PantryItem[]> {
  return db.getAllAsync<PantryItem>(
    `SELECT * FROM pantry_items WHERE status = 'active' AND deleted = 0 ORDER BY cook_by`,
  );
}

export function getPantryItem(db: SQLiteDatabase, id: string): Promise<PantryItem | null> {
  return db.getFirstAsync<PantryItem>(`SELECT * FROM pantry_items WHERE id = ? AND deleted = 0`, id);
}

const EDITABLE = [
  'name', 'quantity', 'unit', 'storage', 'stage', 'confidence', 'purchase',
  'cook_by', 'rescan_tomorrow', 'scan_count', 'status', 'thumbnail_uri',
] as const;
export type PantryPatch = Partial<Pick<PantryItem, (typeof EDITABLE)[number]>>;

/** Update fields and mark the row for sync. */
export async function updatePantryItem(db: SQLiteDatabase, id: string, patch: PantryPatch) {
  const keys = EDITABLE.filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  await db.runAsync(
    `UPDATE pantry_items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ?, dirty = 1 WHERE id = ?`,
    ...keys.map((k) => patch[k] as string | number), Date.now(), id,
  );
}

/**
 * Cook-by, confidence and rescan flag for an item after a storage, stage or
 * purchase change, counted from the day it was added (UC-2.3, 2.4, 2.8).
 */
export function recompute(item: PantryItem, changes: Partial<Pick<PantryItem, 'storage' | 'stage' | 'purchase'>>): PantryPatch {
  const storage = changes.storage ?? item.storage;
  const stage = changes.stage ?? item.stage;
  const purchase = changes.purchase ?? item.purchase;
  const est = estimateCookBy(item.name, storage, stage, purchase, parseIsoDate(item.date_added));
  return {
    storage,
    stage,
    purchase,
    cook_by: toIsoDate(est.cookBy),
    confidence: est.confidence,
    rescan_tomorrow: est.rescanTomorrow ? 1 : 0,
  };
}

/**
 * UC-2.5: mark some or all of an item as used or wasted. A partial amount
 * splits off into its own row so the savings tracker counts just that part.
 */
export async function finishPantryItem(db: SQLiteDatabase, item: PantryItem, status: 'used' | 'wasted', qty: number) {
  if (qty >= item.quantity) {
    await updatePantryItem(db, item.id, { status });
    return;
  }
  await db.withTransactionAsync(async () => {
    await updatePantryItem(db, item.id, { quantity: item.quantity - qty });
    const id = await addPantryItem(db, { ...item, quantity: qty, rescan_tomorrow: !!item.rescan_tomorrow });
    await updatePantryItem(db, id, { status });
  });
}

/** Kept for the scanner's "Log as wasted" (UC-1.6). */
export function setPantryStatus(db: SQLiteDatabase, id: string, status: 'used' | 'wasted') {
  return updatePantryItem(db, id, { status });
}

/** UC-2.8: delete without counting it as waste. */
export async function deletePantryItem(db: SQLiteDatabase, id: string) {
  await db.runAsync(`UPDATE pantry_items SET deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?`, Date.now(), id);
}
