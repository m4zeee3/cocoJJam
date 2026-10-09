import type { SQLiteDatabase } from 'expo-sqlite';

/** Monday 00:00 of this week, local time. */
export function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return d.getTime();
}

/**
 * Spent this week, since Monday: prices paid for pantry items (Palengke Mode,
 * or moved from the shopping list) plus shopping-list items checked off as
 * bought that didn't go to the pantry (vegetables, seasonings).
 */
export async function spentThisWeek(db: SQLiteDatabase) {
  const since = weekStart();
  const pantry = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(paid_price_php) AS total FROM pantry_items WHERE paid_price_php IS NOT NULL AND deleted = 0 AND added_at >= ?`,
    since,
  );
  const list = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(price) AS total FROM shopping_items WHERE checked = 1 AND moved_pantry_id IS NULL AND checked_at >= ?`,
    since,
  );
  return (pantry?.total ?? 0) + (list?.total ?? 0);
}

export type Budget = { weekly: number; spent: number; left: number };

export function budgetFrom(weekly: number | null | undefined, spent: number): Budget | null {
  return weekly ? { weekly, spent, left: Math.max(0, weekly - spent) } : null;
}

export type BudgetFlag = 'over' | 'tight';

/** A tight dish uses at least this share of what's left this week. */
export const TIGHT_SHARE = 0.75;

/**
 * Budget warning for a dish (UC-3.8): it only warns, it never hides or blocks
 * the dish. `toBuy` is what's not already in the pantry.
 */
export function budgetFlag(toBuy: number, budget: Budget | null): BudgetFlag | null {
  if (!budget || toBuy < 1) return null;
  if (toBuy > budget.left) return 'over';
  if (toBuy >= budget.left * TIGHT_SHARE) return 'tight';
  return null;
}
