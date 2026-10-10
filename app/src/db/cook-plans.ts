import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { finishPantryItem, getPantryItem } from '@/db/pantry';
import { addToList, type ListLine } from '@/db/shopping';

/** A pantry item ticked on the recipe, and how much the recipe uses of it. */
export type PlanUse = { id: string; qty: number; unit: string };

export type CookPlan = {
  id: string;
  created_at: number;
  pantry_id: string;
  recipe_id: string;
  recipe_title: string;
  uses_json: string;
  status: 'active' | 'cooked' | 'cancelled';
};

/** A plan with how many of its list items are still to buy. 0 left = Done cooking. */
export type PlanState = CookPlan & { left_to_buy: number };

/** List rows of a plan that aren't bought yet (not checked off, not removed). */
const LEFT_SQL = `(SELECT COUNT(*) FROM plan_items pi JOIN shopping_items s ON s.id = pi.shopping_id
  WHERE pi.plan_id = p.id AND s.deleted = 0 AND s.checked = 0)`;

/**
 * UC-3.10: the user picked a recipe for a pantry item and ticked what they
 * have. Replaces any earlier plan for that item, then puts the unticked lines
 * on the list. With nothing to buy, the item goes straight to Done cooking.
 */
export async function startPlan(
  db: SQLiteDatabase,
  recipe: { id: string; title: string },
  uses: PlanUse[],
  toBuy: ListLine[],
) {
  const planId = randomUUID();
  let result = { added: 0, merged: 0 };
  await db.withTransactionAsync(async () => {
    const old = await db.getFirstAsync<CookPlan>(
      `SELECT * FROM cook_plans WHERE pantry_id = ? AND status = 'active'`,
      uses[0].id,
    );
    if (old) await dropPlan(db, old);
    await db.runAsync(
      `INSERT INTO cook_plans (id, created_at, pantry_id, recipe_id, recipe_title, uses_json) VALUES (?, ?, ?, ?, ?, ?)`,
      planId, Date.now(), uses[0].id, recipe.id, recipe.title, JSON.stringify(uses),
    );
    result = await addToList(db, recipe, toBuy, planId);
  });
  return { planId, ...result };
}

/** The active plan for a pantry item, if any. */
export function planFor(db: SQLiteDatabase, pantryId: string) {
  return db.getFirstAsync<PlanState>(
    `SELECT p.*, ${LEFT_SQL} AS left_to_buy FROM cook_plans p WHERE p.pantry_id = ? AND p.status = 'active'`,
    pantryId,
  );
}

/** Active plans keyed by pantry item, for lists of item cards. */
export async function activePlans(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<PlanState>(`SELECT p.*, ${LEFT_SQL} AS left_to_buy FROM cook_plans p WHERE p.status = 'active'`);
  return new Map(rows.map((r) => [r.pantry_id, r]));
}

/**
 * Cancel without a transaction of its own. The plan's unbought list rows go too,
 * unless another active plan needs the same row.
 */
async function dropPlan(db: SQLiteDatabase, plan: CookPlan) {
  await db.runAsync(
    `UPDATE shopping_items SET deleted = 1
     WHERE checked = 0 AND id IN (SELECT shopping_id FROM plan_items WHERE plan_id = ?)
       AND id NOT IN (SELECT pi.shopping_id FROM plan_items pi JOIN cook_plans o ON o.id = pi.plan_id
                      WHERE o.status = 'active' AND o.id <> ?)`,
    plan.id, plan.id,
  );
  await db.runAsync(`UPDATE cook_plans SET status = 'cancelled' WHERE id = ?`, plan.id);
}

/** "Change recipe" or "Cancel plan" on the item: the button goes back to Cook with this. */
export async function cancelPlan(db: SQLiteDatabase, plan: CookPlan) {
  await db.withTransactionAsync(() => dropPlan(db, plan));
}

/**
 * UC-2.10 Done cooking: the main ingredient leaves the pantry whole, logged as
 * Used in this dish. Other ticked pantry items are used too; when the recipe
 * needs less of one than it has (same unit), only that much, and the rest stays.
 */
export async function doneCooking(db: SQLiteDatabase, plan: CookPlan) {
  const uses = JSON.parse(plan.uses_json) as PlanUse[];
  let count = 0;
  for (const u of uses) {
    const item = await getPantryItem(db, u.id);
    if (!item || item.status !== 'active') continue;
    const main = item.id === plan.pantry_id;
    const qty = !main && item.unit === u.unit && u.qty < item.quantity ? u.qty : item.quantity;
    await finishPantryItem(db, item, 'used', qty, plan.recipe_title);
    count++;
  }
  await db.runAsync(`UPDATE cook_plans SET status = 'cooked' WHERE id = ?`, plan.id);
  return count;
}
