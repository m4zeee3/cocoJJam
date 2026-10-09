import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { addPantryItem } from '@/db/pantry';
import { estimateCookBy, toIsoDate } from '@/domain/cook-by';
import { priceFor, proteinOf } from '@/domain/prices';
import type { Line } from '@/domain/recipes';
import type { Storage } from '@/domain/types';

export type ShoppingItem = {
  id: string;
  created_at: number;
  item: string;
  name: string;
  qty: number;
  unit: string;
  amount: string;
  price: number | null;
  recipe_id: string | null;
  recipe_title: string | null;
  checked: number;
  checked_at: number | null;
  moved_pantry_id: string | null;
};

/** N03 (UC-9.1): add the recipe lines the pantry doesn't cover. Same item from the same recipe isn't added twice. */
export async function addToList(db: SQLiteDatabase, recipe: { id: string; title: string }, lines: Line[]) {
  const now = Date.now();
  let added = 0;
  await db.withTransactionAsync(async () => {
    for (const l of lines) {
      const dup = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM shopping_items WHERE deleted = 0 AND checked = 0 AND item = ? AND recipe_id = ?`,
        l.item, recipe.id,
      );
      if (dup?.n) continue;
      await db.runAsync(
        `INSERT INTO shopping_items (id, created_at, item, name, qty, unit, amount, price, recipe_id, recipe_title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), now, l.item, l.name, l.qty, l.unit, l.amount, l.cost == null ? null : l.toBuy, recipe.id, recipe.title,
      );
      added++;
    }
  });
  return added;
}

/** Items on the list (bought ones stay visible, checked, until moved or cleared). */
export function listShopping(db: SQLiteDatabase) {
  return db.getAllAsync<ShoppingItem>(
    `SELECT * FROM shopping_items WHERE deleted = 0 ORDER BY recipe_title, created_at`,
  );
}

export async function openListCount(db: SQLiteDatabase) {
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM shopping_items WHERE deleted = 0 AND checked = 0`))?.n ?? 0;
}

/** Check off at the market. A checked item counts as spent this week. */
export async function setChecked(db: SQLiteDatabase, id: string, checked: boolean) {
  await db.runAsync(
    `UPDATE shopping_items SET checked = ?, checked_at = ? WHERE id = ?`,
    checked ? 1 : 0, checked ? Date.now() : null, id,
  );
}

export async function removeFromList(db: SQLiteDatabase, id: string) {
  await db.runAsync(`UPDATE shopping_items SET deleted = 1 WHERE id = ?`, id);
}

/**
 * N05 swap: replace a pricier meat with chicken for the same weight (UC-9.1, 4.3).
 * Returns null when there's nothing to gain.
 */
export function proteinSwap(i: ShoppingItem) {
  const kind = proteinOf(i.item);
  if ((kind !== 'pork' && kind !== 'beef') || i.price == null) return null;
  const kg = i.unit === 'g' ? i.qty / 1000 : i.unit === 'kg' ? i.qty : null;
  if (kg == null) return null;
  const chicken = priceFor('chicken', kg);
  if (chicken == null || i.price - chicken < 20) return null;
  return { to: 'chicken', saves: i.price - chicken, price: chicken };
}

export async function applySwap(db: SQLiteDatabase, i: ShoppingItem, price: number) {
  await db.runAsync(
    `UPDATE shopping_items SET item = 'chicken', name = 'Chicken', amount = ?, price = ? WHERE id = ?`,
    i.amount.replace(/,.*$/, '') + ', cut up', price, i.id,
  );
}

/**
 * N06: move checked meat and fish into the pantry (bought today, price paid =
 * the list estimate). Checked vegetables and seasonings just leave the list:
 * the pantry is beef, pork, chicken and fish only.
 */
export async function moveBoughtToPantry(db: SQLiteDatabase, storage: Record<string, Storage>) {
  const bought = await db.getAllAsync<ShoppingItem>(`SELECT * FROM shopping_items WHERE deleted = 0 AND checked = 1`);
  let moved = 0;
  await db.withTransactionAsync(async () => {
    for (const i of bought) {
      if (proteinOf(i.item)) {
        const where = storage[i.id] ?? 'ref';
        const est = estimateCookBy(i.item, where, 'fresh', 'today');
        const pantryId = await addPantryItem(db, {
          name: i.item,
          category: null,
          quantity: i.qty,
          unit: i.unit,
          storage: where,
          stage: 'fresh',
          confidence: 'medium',
          purchase: 'today',
          date_added: toIsoDate(new Date()),
          cook_by: toIsoDate(est.cookBy),
          thumbnail_uri: null,
          paid_price_php: i.price,
        });
        await db.runAsync(`UPDATE shopping_items SET moved_pantry_id = ?, deleted = 1 WHERE id = ?`, pantryId, i.id);
        moved++;
      } else {
        await db.runAsync(`UPDATE shopping_items SET deleted = 1 WHERE id = ?`, i.id);
      }
    }
  });
  return moved;
}
