import prices from '@/data/prices.json';
import type { PantryItem } from '@/db/pantry';
import { pantryValue, proteinOf, type Protein } from '@/domain/prices';

type Row = { unit: string; piece_qty: number };
const TABLE = prices.items as Record<string, Row>;

/** Rough weights for units the price table doesn't measure in kg. */
const UNIT_KG: Record<string, number> = { bundle: 0.25, pack: 0.1, bottle: 0.35 };

/** Estimated weight of a pantry item in kg, for "kg of food rescued". */
export function weightKg(item: Pick<PantryItem, 'name' | 'quantity' | 'unit'>) {
  const row = TABLE[item.name];
  if (item.unit === 'kg') return item.quantity;
  if (item.unit === 'g') return item.quantity / 1000;
  if (item.unit === 'pc') {
    if (row?.unit === 'kg') return item.quantity * row.piece_qty;
    return item.quantity * (UNIT_KG[row?.unit ?? ''] ?? 0.2);
  }
  return item.quantity * (UNIT_KG[item.unit] ?? 0.2);
}

/** A family meal is about ₱300 at this month's prices (sample assumption). */
const PESOS_PER_MEAL = 300;

type Group = Protein;
const TIP: Record<Group, string> = {
  fish: 'Most waste this month was fish. Cook it within 1–2 days, or freeze it the day you buy it.',
  pork: "Most waste this month was pork. Freeze it in meal-size portions if you won't cook it in 3 days.",
  chicken: 'Most waste this month was chicken. It keeps only 1–2 days in the ref, so freeze what you won’t cook soon.',
  beef: 'Most waste this month was beef. Wrap it tightly and freeze it if you won’t cook it within 3 days.',
};

export type MonthSummary = {
  saved: number;
  wasted: number;
  wastedCount: number;
  kgRescued: number;
  meals: number;
  /** Week 1 = days 1–7 … week 4 = day 22 to month end. */
  weeks: { label: string; saved: number; wasted: number }[];
  tip: string;
};

/** UC-8.1: this month's totals from pantry items marked Used or Wasted. */
export function summarizeMonth(items: (PantryItem & { updated_at: number })[]): MonthSummary {
  const weeks = [1, 2, 3, 4].map((n) => ({ label: `Wk ${n}`, saved: 0, wasted: 0 }));
  const wastedBy: Record<Group, number> = { fish: 0, pork: 0, chicken: 0, beef: 0 };
  let saved = 0;
  let wasted = 0;
  let wastedCount = 0;
  let kgRescued = 0;
  for (const i of items) {
    const value = pantryValue(i);
    // `updated_at` is when it was marked Used or Wasted.
    const week = Math.min(3, Math.floor((new Date(i.updated_at).getDate() - 1) / 7));
    if (i.status === 'used') {
      saved += value;
      kgRescued += weightKg(i);
      weeks[week].saved += value;
    } else if (i.status === 'wasted') {
      wasted += value;
      wastedCount++;
      weeks[week].wasted += value;
      wastedBy[proteinOf(i.name) ?? 'fish'] += value;
    }
  }
  const worst = (Object.keys(wastedBy) as Group[]).sort((a, b) => wastedBy[b] - wastedBy[a])[0];
  return {
    saved,
    wasted,
    wastedCount,
    kgRescued,
    meals: Math.floor(saved / PESOS_PER_MEAL),
    weeks,
    tip: wasted > 0 ? TIP[worst] : 'Nothing wasted so far this month. Galing!',
  };
}
