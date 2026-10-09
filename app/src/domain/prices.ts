import prices from '@/data/prices.json';

type PriceRow = { unit: string; low: number; high: number; piece_qty: number; trend?: 'up'; reason?: string };

const TABLE = prices.items as Record<string, PriceRow>;

export const PRICE_AS_OF = prices.as_of; // "YYYY-MM"

/** Month name of the price table, e.g. "Oct". */
export function priceMonth(format: 'short' | 'long' = 'short') {
  const [y, m] = PRICE_AS_OF.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: format });
}

/** Midpoint price for `qty` in the table's unit (UC-4.1); null when the item has no price. */
export function priceFor(item: string, qty: number): number | null {
  const row = TABLE[item];
  return row ? ((row.low + row.high) / 2) * qty : null;
}

/** `qty` of `unit` (pc, g, kg, bundle …) expressed in the price table's unit for `item`. */
export function costQty(item: string, qty: number, unit: string) {
  const row = TABLE[item];
  if (!row || unit === row.unit) return qty;
  if (unit === 'pc') return qty * row.piece_qty;
  if (unit === 'g' && row.unit === 'kg') return qty / 1000;
  if (unit === 'kg' && row.unit === 'g') return qty * 1000;
  return qty * row.piece_qty;
}

/** Value of a pantry item: what was paid in Palengke Mode, else the seasonal midpoint. */
export function pantryValue(item: { name: string; quantity: number; unit: string; paid_price_php: number | null }) {
  if (item.paid_price_php != null) return item.paid_price_php;
  const row = TABLE[item.name];
  if (!row) return 0;
  return priceFor(item.name, costQty(item.name, item.quantity, item.unit)) ?? 0;
}

/** Items priced above their usual range this month (UC-4.2), for Price watch. */
export function priceWatch() {
  return Object.entries(TABLE)
    .filter(([, row]) => row.trend === 'up')
    .map(([item, row]) => ({ item, reason: row.reason ?? '' }));
}

export function peso(amount: number) {
  return `₱${Math.round(amount).toLocaleString('en-US')}`;
}
