import type { SQLiteDatabase } from 'expo-sqlite';

import { addScan } from '@/db/history';
import { addPantryItem } from '@/db/pantry';
import { toIsoDate } from '@/domain/cook-by';
import type { Stage, Storage } from '@/domain/types';

const SAMPLE: { name: string; quantity: number; unit: string; storage: Storage; stage: Stage; days: number }[] = [
  // Beef, pork, chicken and fish only: the app's dataset. 6 items at different urgency (demo script).
  { name: 'bangus', quantity: 2, unit: 'pc', storage: 'ref', stage: 'good', days: 0 },
  { name: 'chicken', quantity: 1, unit: 'kg', storage: 'ref', stage: 'use_soon', days: 0 },
  { name: 'tilapia', quantity: 2, unit: 'pc', storage: 'ref', stage: 'good', days: 1 },
  { name: 'pork', quantity: 500, unit: 'g', storage: 'ref', stage: 'good', days: 2 },
  { name: 'galunggong', quantity: 6, unit: 'pc', storage: 'freezer', stage: 'fresh', days: 45 },
  { name: 'beef', quantity: 1, unit: 'kg', storage: 'freezer', stage: 'fresh', days: 120 },
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
    // Used and wasted items earlier this month, so Savings has a story to tell (UC-8.1).
    const day = today.getDate();
    const finished: { name: string; quantity: number; unit: string; status: 'used' | 'wasted'; daysAgo: number; note: string }[] = [
      { name: 'pork', quantity: 500, unit: 'g', status: 'used', daysAgo: 1, note: 'Pork Adobo' },
      { name: 'bangus', quantity: 2, unit: 'pc', status: 'used', daysAgo: 1, note: 'Sinigang na Bangus' },
      { name: 'galunggong', quantity: 6, unit: 'pc', status: 'used', daysAgo: 2, note: 'Pritong Galunggong' },
      { name: 'tilapia', quantity: 1, unit: 'pc', status: 'wasted', daysAgo: 2, note: 'past estimate' },
      { name: 'chicken', quantity: 1, unit: 'kg', status: 'used', daysAgo: 6, note: 'Chicken Adobo' },
      { name: 'bangus', quantity: 1, unit: 'pc', status: 'wasted', daysAgo: 7, note: 'smelled off' },
      { name: 'beef', quantity: 500, unit: 'g', status: 'used', daysAgo: 9, note: 'Bistek Tagalog' },
      { name: 'tilapia', quantity: 2, unit: 'pc', status: 'used', daysAgo: 12, note: 'Pritong Tilapia' },
      { name: 'pork', quantity: 750, unit: 'g', status: 'used', daysAgo: 15, note: 'Sinigang na Baboy' },
      { name: 'chicken', quantity: 500, unit: 'g', status: 'wasted', daysAgo: 16, note: 'slimy' },
    ];
    for (const f of finished.filter((x) => x.daysAgo < day)) {
      const at = new Date(today);
      at.setDate(day - f.daysAgo);
      const id = await addPantryItem(db, {
        name: f.name,
        category: null,
        quantity: f.quantity,
        unit: f.unit,
        storage: 'ref',
        stage: f.status === 'wasted' ? 'spoiled' : 'good',
        confidence: 'high',
        date_added: toIsoDate(at),
        cook_by: toIsoDate(at),
        thumbnail_uri: null,
        paid_price_php: null,
      });
      await db.runAsync(`UPDATE pantry_items SET status = ?, finish_note = ?, updated_at = ? WHERE id = ?`, f.status, f.note, at.getTime(), id);
    }

    const yesterday = today.getTime() - 86_400_000;
    await addScan(db, [{ name: 'pork', stage: 'good' }, { name: 'tilapia', stage: 'good' }, { name: 'chicken', stage: 'use_soon' }], yesterday);
    await addScan(db, [{ name: 'bangus', stage: 'good' }, { name: 'chicken', stage: 'use_soon' }]);
  });
}
