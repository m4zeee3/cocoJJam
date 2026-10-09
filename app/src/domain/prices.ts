import prices from '@/data/prices.json';

/** The app's dataset is beef, pork, chicken and fish; 'ingredient' rows only cost recipes. */
export type Protein = 'fish' | 'pork' | 'chicken' | 'beef';
export type PriceCategory = Protein | 'ingredient';

type PriceRow = {
  unit: string;
  low: number;
  high: number;
  piece_qty: number;
  category: PriceCategory;
  /** 12-month average midpoint. */
  avg: number;
  reason_title?: string;
  reason?: string;
  /** Last 12 monthly midpoints, oldest first. */
  history?: number[];
  /** "PSA retail prices via WFP (HDX), NCR, 2026-08", or "sample". */
  source?: string;
};

const TABLE = prices.items as Record<string, PriceRow>;

export const PRICE_AS_OF = prices.as_of; // "YYYY-MM"

/** Where the reference prices come from, for labels and the attribution line (CC BY-IGO). */
export const PRICE_SOURCE = (prices as { source?: string }).source ?? 'Sample prices';
export const PRICE_ATTRIBUTION = (prices as { attribution?: string }).attribution ?? 'Sample prices, not sourced.';

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

/** A change of at least this much vs the 12-month average gets an arrow (UC-4.2). */
export const NOTABLE_CHANGE = 0.05;

export type PriceInfo = PriceRow & {
  item: string;
  mid: number;
  /** This month's midpoint vs the 12-month average, e.g. 0.26 = 26% higher. */
  change: number;
};

/** Everything the price screens show for one item; null when it isn't in the table (UC-4.5). */
export function priceInfo(item: string): PriceInfo | null {
  const row = TABLE[item];
  if (!row) return null;
  const mid = (row.low + row.high) / 2;
  return { ...row, item, mid, change: row.avg ? (mid - row.avg) / row.avg : 0 };
}

/** Market prices (E04) and Price watch: proteins only. */
export function allPrices(): PriceInfo[] {
  return Object.keys(TABLE)
    .map((k) => priceInfo(k)!)
    .filter((p) => p.category !== 'ingredient');
}

/** fish / pork / chicken / beef for a scannable item, null for anything else. */
export function proteinOf(item: string): Protein | null {
  const c = TABLE[item]?.category;
  return c && c !== 'ingredient' ? c : null;
}

/** "+26%", "−5%", "0%". */
export function changeLabel(change: number) {
  const pct = Math.round(change * 100);
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : '0%';
}

/**
 * Items notably pricier than their 12-month average (UC-4.2), biggest jump first.
 * The reason is a curated tag when the team has written one, else the plain number.
 */
export function priceWatch() {
  return allPrices()
    .filter((p) => p.change >= NOTABLE_CHANGE)
    .sort((a, b) => b.change - a.change)
    .map((p) => ({
      item: p.item,
      reason: p.reason ?? `${changeLabel(p.change)} vs its 12-month average.`,
      change: p.change,
    }));
}

export function peso(amount: number) {
  return `₱${Math.round(amount).toLocaleString('en-US')}`;
}
