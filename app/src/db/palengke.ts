import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { addPantryItem } from '@/db/pantry';
import { estimateCookBy, toIsoDate } from '@/domain/cook-by';
import type { VendorUnit, VerdictKind } from '@/domain/palengke';
import type { Stage, Storage } from '@/domain/types';

export type PalengkeCheck = {
  id: string;
  created_at: number;
  item: string;
  cut: string | null;
  stage: Stage;
  price: number;
  unit: VendorUnit;
  verdict: VerdictKind;
  stall: string;
  photo_uri: string | null;
  bought: number;
};

/** One market trip = checks from the last few hours (UC-6.7). */
const TRIP_MS = 4 * 60 * 60 * 1000;

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export async function addCheck(db: SQLiteDatabase, c: Omit<PalengkeCheck, 'id' | 'created_at' | 'bought'>) {
  const id = randomUUID();
  await db.runAsync(
    `INSERT INTO palengke_checks (id, created_at, item, cut, stage, price, unit, verdict, stall, photo_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, Date.now(), c.item, c.cut, c.stage, c.price, c.unit, c.verdict, c.stall, c.photo_uri,
  );
  return id;
}

/** M01 "Today's checks", newest first. */
export function listTodayChecks(db: SQLiteDatabase) {
  return db.getAllAsync<PalengkeCheck>(
    `SELECT * FROM palengke_checks WHERE created_at >= ? ORDER BY created_at DESC`,
    startOfToday(),
  );
}

/** Earlier checks of the same item (and cut) on this trip, oldest first. */
export function listTripChecks(db: SQLiteDatabase, item: string, cut: string | null) {
  return db.getAllAsync<PalengkeCheck>(
    `SELECT * FROM palengke_checks WHERE item = ? AND IFNULL(cut, '') = ? AND created_at >= ? ORDER BY created_at`,
    item, cut ?? '', Date.now() - TRIP_MS,
  );
}

export function renameStall(db: SQLiteDatabase, id: string, stall: string) {
  return db.runAsync(`UPDATE palengke_checks SET stall = ? WHERE id = ?`, stall, id);
}

/**
 * UC-6.6: add a bought item to the pantry with today's date and the price paid.
 * Price is per `unit`; we add 1 of that unit.
 */
export async function buyFromCheck(db: SQLiteDatabase, check: PalengkeCheck, storage: Storage = 'ref') {
  const est = estimateCookBy(check.item, storage, check.stage, 'today');
  const unit = check.unit === 'tali' ? 'bundle' : check.unit;
  const pantryId = await addPantryItem(db, {
    name: check.item,
    category: check.cut,
    quantity: 1,
    unit,
    storage,
    stage: check.stage,
    confidence: est.confidence,
    purchase: 'today',
    date_added: toIsoDate(new Date()),
    cook_by: toIsoDate(est.cookBy),
    thumbnail_uri: check.photo_uri,
    paid_price_php: check.price,
  });
  await db.runAsync(`UPDATE palengke_checks SET bought = 1 WHERE id = ?`, check.id);
  return { pantryId, daysLeft: est.daysLeft };
}
