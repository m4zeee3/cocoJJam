import type { SQLiteDatabase } from 'expo-sqlite';

import { addScan } from '@/db/history';
import { addPantryItem } from '@/db/pantry';
import { toIsoDate } from '@/domain/cook-by';
import type { Stage, Storage } from '@/domain/types';

const SAMPLE: { name: string; quantity: number; unit: string; storage: Storage; stage: Stage; days: number }[] = [
  { name: 'bangus', quantity: 2, unit: 'pc', storage: 'ref', stage: 'good', days: 0 },
  { name: 'kangkong', quantity: 1, unit: 'bundle', storage: 'ref', stage: 'use_soon', days: 0 },
  { name: 'tomato', quantity: 4, unit: 'pc', storage: 'counter', stage: 'use_soon', days: 1 },
  { name: 'pork', quantity: 1, unit: 'pc', storage: 'ref', stage: 'good', days: 2 },
  { name: 'onion', quantity: 3, unit: 'pc', storage: 'counter', stage: 'good', days: 3 },
  { name: 'banana', quantity: 6, unit: 'pc', storage: 'counter', stage: 'fresh', days: 4 },
  { name: 'garlic', quantity: 1, unit: 'pc', storage: 'counter', stage: 'fresh', days: 14 },
  { name: 'chicken', quantity: 1, unit: 'pc', storage: 'freezer', stage: 'fresh', days: 60 },
  { name: 'ginger', quantity: 1, unit: 'pc', storage: 'ref', stage: 'fresh', days: 10 },
];

/** Demo data so the full Home dashboard (UC-12.2) shows without scanning first. */
export async function loadSamplePantry(db: SQLiteDatabase) {
  const today = new Date();
  await db.withTransactionAsync(async () => {
    for (const s of SAMPLE) {
      const cookBy = new Date(today);
      cookBy.setDate(today.getDate() + s.days);
      await addPantryItem(db, {
        name: s.name,
        category: null,
        quantity: s.quantity,
        unit: s.unit,
        storage: s.storage,
        stage: s.stage,
        confidence: 'high',
        date_added: toIsoDate(today),
        cook_by: toIsoDate(cookBy),
        thumbnail_uri: null,
        paid_price_php: null,
      });
    }
    const yesterday = today.getTime() - 86_400_000;
    await addScan(db, [{ name: 'pork', stage: 'good' }, { name: 'onion', stage: 'good' }, { name: 'tomato', stage: 'use_soon' }], yesterday);
    await addScan(db, [{ name: 'bangus', stage: 'good' }, { name: 'kangkong', stage: 'use_soon' }]);
  });
}
