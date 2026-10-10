import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { addPantryItem } from '@/db/pantry';
import { estimateCookBy, toIsoDate } from '@/domain/cook-by';
import { changeLabel, NOTABLE_CHANGE, priceFor, priceInfo, proteinOf } from '@/domain/prices';
import { formatAmount, type Line } from '@/domain/recipes';
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

/** A line to buy: a recipe ingredient the user didn't tick as "I have this" (UC-3.10). */
export type ListLine = Pick<Line, 'item' | 'name' | 'qty' | 'unit' | 'amount'> & { price: number | null };

/** Recipes a row is for, as stored in `recipe_title`: "Sinigang na Bangus, Chicken Adobo". */
export const recipeTags = (i: Pick<ShoppingItem, 'recipe_title'>) => (i.recipe_title ? i.recipe_title.split(', ') : []);

/**
 * UC-9.1: put a recipe's unticked lines on the list, one row per item. An item
 * already on the list (same unit, not bought yet) gets this recipe's amount
 * added and the recipe tagged, unless that recipe is already counted in it.
 * With `planId`, every row is linked to the plan so it knows what's left to buy.
 */
export async function addToList(
  db: SQLiteDatabase,
  recipe: { id: string; title: string },
  lines: ListLine[],
  planId?: string,
) {
  const now = Date.now();
  let added = 0;
  let merged = 0;
  const run = async () => {
    for (const l of lines) {
      const same = await db.getFirstAsync<ShoppingItem>(
        `SELECT * FROM shopping_items WHERE deleted = 0 AND checked = 0 AND item = ? AND unit = ? ORDER BY created_at LIMIT 1`,
        l.item, l.unit,
      );
      let rowId: string;
      if (same) {
        rowId = same.id;
        if (!recipeTags(same).includes(recipe.title)) {
          const qty = same.qty + l.qty;
          await db.runAsync(
            `UPDATE shopping_items SET qty = ?, amount = ?, price = ?, recipe_title = ? WHERE id = ?`,
            qty, formatAmount(qty, l.unit),
            same.price == null && l.price == null ? null : (same.price ?? 0) + (l.price ?? 0),
            [...recipeTags(same), recipe.title].join(', '), same.id,
          );
          merged++;
        }
      } else {
        rowId = randomUUID();
        await db.runAsync(
          `INSERT INTO shopping_items (id, created_at, item, name, qty, unit, amount, price, recipe_id, recipe_title)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          rowId, now, l.item, l.name, l.qty, l.unit, l.amount, l.price, recipe.id, recipe.title,
        );
        added++;
      }
      if (planId) await db.runAsync(`INSERT OR IGNORE INTO plan_items (plan_id, shopping_id) VALUES (?, ?)`, planId, rowId);
    }
  };
  // Callers that already hold a transaction (startPlan) pass their own.
  if (planId) await run();
  else await db.withTransactionAsync(run);
  return { added, merged };
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

/** N04 sections: what kind of item each row is. The pantry only takes meat and fish. */
export type ListGroup = 'Meat & fish' | 'Gulay' | 'Others';
export const LIST_GROUPS: ListGroup[] = ['Meat & fish', 'Gulay', 'Others'];

const GULAY = new Set(['kangkong', 'tomato', 'radish', 'sitaw', 'malunggay', 'papaya', 'siling haba']);

export function listGroup(item: string): ListGroup {
  if (proteinOf(item)) return 'Meat & fish';
  return GULAY.has(item) ? 'Gulay' : 'Others';
}

/** A way to bring the list under budget (N05): `item` is the row it changes, `from`/`to` the item keys (to = null: dropped). */
export type BudgetSwap = {
  item: ShoppingItem;
  from: string;
  to: string | null;
  title: string;
  reason: string;
  saves: number;
  apply: (db: SQLiteDatabase) => Promise<void>;
};

/** Sinigang vegetables that can stand in for each other. */
const SOUP_GULAY = ['radish', 'sitaw', 'kangkong'];

/** Least saving worth suggesting. */
const MIN_SAVING = 10;

/** Pork or beef → chicken for the same weight (UC-9.1, 4.3). */
function proteinSwap(i: ShoppingItem): BudgetSwap | null {
  const kind = proteinOf(i.item);
  if ((kind !== 'pork' && kind !== 'beef') || i.price == null) return null;
  const kg = i.unit === 'g' ? i.qty / 1000 : i.unit === 'kg' ? i.qty : null;
  if (kg == null) return null;
  const chicken = priceFor('chicken', kg);
  if (chicken == null || i.price - chicken < 2 * MIN_SAVING) return null;
  const change = priceInfo(kind)?.change ?? 0;
  const name = kind === 'pork' ? 'Pork' : 'Beef';
  return {
    item: i,
    from: i.item,
    to: 'chicken',
    title: `Swap ${i.name.toLowerCase()} for chicken`,
    reason: change >= NOTABLE_CHANGE
      ? `${name} is ${changeLabel(change).slice(1)} above usual this month`
      : `${i.recipe_title ?? 'Same dish'} · same weight`,
    saves: i.price - chicken,
    apply: async (db) => {
      await db.runAsync(
        `UPDATE shopping_items SET item = 'chicken', name = 'Chicken', amount = ?, price = ? WHERE id = ?`,
        i.amount.replace(/,.*$/, '') + ', cut up', chicken, i.id,
      );
    },
  };
}

/** Skip one sinigang vegetable and buy half again of another from the same recipe. */
function gulaySwap(skip: ShoppingItem, more: ShoppingItem): BudgetSwap | null {
  if (skip.price == null || more.price == null) return null;
  const extra = more.price / 2;
  const saves = skip.price - extra;
  if (saves < MIN_SAVING) return null;
  const qty = more.qty * 1.5;
  const prep = more.amount.includes(',') ? more.amount.slice(more.amount.indexOf(',')) : '';
  const dish = skip.recipe_title?.replace(/ na .*/, '').toLowerCase() ?? 'dish';
  return {
    item: skip,
    from: skip.item,
    to: more.item,
    title: `Skip ${skip.name.replace(/ \(.*\)/, '').toLowerCase()}, add more ${more.name.toLowerCase()}`,
    reason: `Same ${dish}, a little different`,
    saves,
    apply: async (db) => {
      await db.withTransactionAsync(async () => {
        await db.runAsync(`UPDATE shopping_items SET deleted = 1 WHERE id = ?`, skip.id);
        await db.runAsync(
          `UPDATE shopping_items SET qty = ?, amount = ?, price = ? WHERE id = ?`,
          qty, formatAmount(qty, more.unit) + prep, more.price! + extra, more.id,
        );
      });
    },
  };
}

/** N05: swaps for the unchecked items, biggest saving first. One vegetable swap per recipe. */
export function budgetSwaps(open: ShoppingItem[]): BudgetSwap[] {
  const swaps = open.map(proteinSwap).filter((s): s is BudgetSwap => s != null);
  const recipes = new Set(open.map((i) => i.recipe_id));
  for (const r of recipes) {
    const soup = open.filter((i) => i.recipe_id === r && SOUP_GULAY.includes(i.item) && i.price != null);
    const best = soup
      .flatMap((skip) => soup.filter((m) => m !== skip).map((more) => gulaySwap(skip, more)))
      .filter((s): s is BudgetSwap => s != null)
      .sort((a, b) => b.saves - a.saves)[0];
    if (best) swaps.push(best);
  }
  return swaps.sort((a, b) => b.saves - a.saves);
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
